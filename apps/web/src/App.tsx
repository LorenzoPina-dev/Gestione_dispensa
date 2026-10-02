import { useState, useEffect, useMemo } from "react";
import type { AuthUser, AuthScreen } from "./store/auth";
import type { ShoppingList, Role } from "./types";
import { colors, fonts } from "./tokens";
import { expiryDays } from "./utils/expiry";
import { ROLE_LABELS } from "./utils/roles";
import AvatarUI from "./components/ui/Avatar";
import { ConfirmModal } from "./components/ui/Modal";
import SyncIssuesBanner from "./components/SyncIssuesBanner";
import { useInventory } from "./hooks/useInventory";
import { useShoppingList } from "./hooks/useShoppingList";
import { useFamilyMembers } from "./hooks/useFamily";
import { useNotifications } from "./hooks/useNotifications";
import { useAuthStore } from "./store/auth";
import { getCurrentUser, listFamilies } from "./api/endpoints";
import { ApiError, isBackendUnreachable } from "./api/client";
import { useScreenView } from "./hooks/useScreenView";
import { mapStockItemDtoToUi, mapActiveShoppingListDtoToUi } from "./api/mappers";

import Login from "./pages/auth/Login";
import Register from "./pages/auth/Register";
import ForgotPassword from "./pages/auth/ForgotPassword";
import Onboarding from "./pages/onboarding/Onboarding";
import Oggi from "./pages/Oggi";
import Dispensa from "./pages/Dispensa";
import Spesa from "./pages/Spesa";
import Ricette from "./pages/Ricette";
import Nutrienti from "./pages/Nutrienti";
import Famiglia from "./pages/Famiglia";
import Notifiche from "./pages/Notifiche";
import MobileBottomNav from "./components/MobileBottomNav";

type Tab = "oggi" | "dispensa" | "spesa" | "ricette" | "nutrienti" | "famiglia" | "notifiche";

const CAN_WRITE: Role[] = ["OWNER", "MANAGER", "MEMBER"];
const CAN_MANAGE_FAMILY: Role[] = ["OWNER", "MANAGER"];

function normalizeFamilyRole(role: string | undefined): Role {
  switch (role?.toLowerCase()) {
    case "owner": return "OWNER";
    case "admin":
    case "manager": return "MANAGER";
    case "member": return "MEMBER";
    case "viewer": return "VIEWER";
    default: return "VIEWER";
  }
}

/**
 * Session bootstrap is deliberately tolerant of a missing family.
 * A valid authenticated user with zero families is a normal state: it means onboarding
 * has not been completed yet. Only authentication failures invalidate the session.
 */
export default function App() {
  const [screen, setScreen] = useState<AuthScreen>("login");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [tab, setTab] = useState<Tab>("oggi");
  const [sessionChecked, setSessionChecked] = useState(false);

  const authToken = useAuthStore((s) => s.token);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      if (!authToken) {
        if (!cancelled) {
          setCurrentUser(null);
          setScreen("login");
          setSessionChecked(true);
        }
        return;
      }

      try {
        const apiUser = await getCurrentUser();

        if (!apiUser?.id) {
          throw new ApiError(502, {
            error: {
              code: "INVALID_USER_PROFILE",
              message: "L'API non ha restituito un profilo utente valido.",
              retryable: true,
            },
            meta: { requestId: "", traceId: "", schemaVersion: "" },
          });
        }

        let familyList: Awaited<ReturnType<typeof listFamilies>>["families"] = [];

        try {
          const families = await listFamilies();
          familyList = Array.isArray(families?.families) ? families.families : [];
        } catch (familyError) {
          if (
            familyError instanceof ApiError &&
            (familyError.status === 401 || familyError.status === 403)
          ) {
            throw familyError;
          }
          // The identity is still valid. With no usable family data, send the user
          // through onboarding rather than dereferencing an undefined response.
        }

        const active = apiUser.activeFamilyId
          ? familyList.find((f) => f.familyId === apiUser.activeFamilyId)
          : familyList[0];

        const user: AuthUser = {
          id: apiUser.userId,
          name: apiUser.displayName || apiUser.email || "Utente",
          email: apiUser.email || "",
          avatar: (apiUser.displayName || apiUser.email || "U").slice(0, 2).toUpperCase(),
          role: normalizeFamilyRole(active?.role),
          hasFamilyId: active?.familyId || null,
        };

        if (!cancelled) {
          setCurrentUser(user);
          setScreen(user.hasFamilyId ? "app" : "onboarding");
          setSessionChecked(true);
        }
      } catch (err) {
        if (!cancelled) {
          if (isBackendUnreachable(err)) {
            setSessionChecked(true);
            return;
          }

          if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
            useAuthStore.setState({
              token: null,
              refreshToken: null,
              expiresAt: null,
              user: null,
              isAuthenticated: false,
            });
            setCurrentUser(null);
            setScreen("login");
            setSessionChecked(true);
            return;
          }

          // Preserve the authenticated session on transient/domain/upstream failures.
          setSessionChecked(true);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [authToken]);

  const familyId = authToken !== null ? (currentUser?.hasFamilyId ?? null) : null;
  const composite = useScreenView(tab, familyId);

  // Composite data is remote state. Keep mapped references stable so domain hooks can
  // distinguish hydration/revalidation from real user mutations.
  const initialStock = useMemo(
    () => composite.data?.pantry?.map(mapStockItemDtoToUi),
    [composite.data?.pantry],
  );

  const initialShopping = useMemo(
    () =>
      composite.data?.shopping
        ? mapActiveShoppingListDtoToUi(composite.data.shopping)
        : composite.data?.shopping === null
          ? { id: "", name: "Spesa", status: "ACTIVE" as const, version: 0, items: [] }
          : undefined,
    [composite.data?.shopping],
  );

  const initialMembers = useMemo(
    () =>
      composite.data?.members?.map((m) => {
        const memberId = m.id || m.userId;
        return {
          id: memberId,
          name: m.name || `Utente ${m.userId.slice(0, 8)}`,
          email: m.email || "",
          avatar: m.avatar || m.userId.slice(0, 2).toUpperCase(),
          role: normalizeFamilyRole(String(m.role)),
          status: m.status || "ACTIVE",
          version: m.version,
        };
      }),
    [composite.data?.members],
  );

  const initialNotifications = useMemo(
    () =>
      composite.data?.notifications?.map((n) => {
        const type = String(n.type ?? "").toLowerCase();
        const category =
          n.category ??
          (type.includes("invite")
            ? "INVITE"
            : type.includes("reorder") || type.includes("stock") || type.includes("expiration")
              ? "REORDER"
              : "SYSTEM");
        return {
          id: n.id ?? n.notificationId ?? "",
          category,
          title: n.title,
          body: n.body,
          createdAt: n.createdAt,
          ...(n.readAt ? { readAt: n.readAt } : {}),
        };
      }),
    [composite.data?.notifications],
  );

  const inventory = useInventory(familyId, initialStock);
  const shopping = useShoppingList(familyId, initialShopping);
  const family = useFamilyMembers(
    familyId,
    initialMembers,
    composite.data?.family?.name,
  );
  const notificationState = useNotifications(familyId, initialNotifications);

  const stock = inventory.stock;
  const setStock = inventory.setStock;
  const shoppingList = shopping.list;
  const setShoppingList = shopping.setList;
  const notifications = notificationState.notifications;
  const setNotifications = notificationState.setNotifications;

  const [isOffline, setIsOffline] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  function handleLogin(user: AuthUser) {
    setCurrentUser(user);
    setScreen(user.hasFamilyId ? "app" : "onboarding");
  }

  function handleRegistered(user: AuthUser) {
    setCurrentUser(user);
    setScreen("onboarding");
  }

  function handleOnboardingComplete(user: AuthUser) {
    setCurrentUser(user);
    setScreen("app");
  }

  function handleLogout() {
    useAuthStore.getState().clearToken();
    setCurrentUser(null);
    setScreen("login");
    setTab("oggi");
    setShowLogoutConfirm(false);
  }

  if (!sessionChecked) return null;

  if (screen === "login") {
    return (
      <Login
        onLogin={handleLogin}
        onRegister={() => setScreen("register")}
        onForgot={() => setScreen("forgot")}
      />
    );
  }

  if (screen === "register") {
    return (
      <Register
        onRegistered={handleRegistered}
        onLogin={() => setScreen("login")}
      />
    );
  }

  if (screen === "forgot") {
    return <ForgotPassword onBack={() => setScreen("login")} />;
  }

  if (screen === "onboarding" && currentUser) {
    return <Onboarding user={currentUser} onComplete={handleOnboardingComplete} />;
  }

  if (!currentUser) return null;

  const role = currentUser.role;
  const canWrite = CAN_WRITE.includes(role);
  const canManage = CAN_MANAGE_FAMILY.includes(role);

  const expiredCount = stock.filter((s) => {
    const d = expiryDays(s.batches);
    return d !== null && d <= 0;
  }).length;

  const expiringCount = stock.filter((s) => {
    const d = expiryDays(s.batches);
    return d !== null && d > 0 && d <= 5;
  }).length;

  const unreadNotifs = notifications.filter((n) => !n.readAt).length;
  const urgentBadge = expiredCount + expiringCount;

  const ALL_NAV: { key: Tab; label: string; icon: string }[] = [
    { key: "oggi", label: "Oggi", icon: "🏠" },
    { key: "dispensa", label: "Dispensa", icon: "🏺" },
    { key: "spesa", label: "Spesa", icon: "🛒" },
    { key: "ricette", label: "Ricette", icon: "👨‍🍳" },
    { key: "nutrienti", label: "Nutrienti", icon: "📊" },
    { key: "famiglia", label: "Famiglia", icon: "👥" },
    { key: "notifiche", label: "Notifiche", icon: "🔔" },
  ];

  const visibleNav =
    role === "VIEWER"
      ? ALL_NAV.filter((n) =>
          ["oggi", "dispensa", "ricette", "nutrienti", "notifiche"].includes(n.key),
        )
      : ALL_NAV;

  const currentTab = visibleNav.find((n) => n.key === tab) ? tab : "oggi";

  function navBadge(key: Tab) {
    if (key === "oggi" && urgentBadge > 0) return urgentBadge;
    if (key === "notifiche" && unreadNotifs > 0) return unreadNotifs;
    return 0;
  }

  return (
    <div
      className="flex min-h-[100dvh] flex-col overflow-x-hidden"
      style={{ backgroundColor: colors.cream, fontFamily: "var(--font-sans)" }}
    >
      {isOffline && (
        <div
          className="px-4 py-2 text-center text-xs font-medium"
          style={{
            backgroundColor: colors.amberLight,
            color: colors.amberDark,
          }}
        >
          Sei offline. Le modifiche verranno sincronizzate appena torni online.
        </div>
      )}

      {role !== "OWNER" && role !== "MANAGER" && (
        <div
          className="px-4 py-2 text-center text-xs font-medium"
          style={{
            backgroundColor: role === "VIEWER" ? colors.creamDark : colors.sageLight,
            color: role === "VIEWER" ? colors.inkMuted : colors.sageDark,
          }}
        >
          {role === "VIEWER"
            ? "Modalità sola lettura — sei un visualizzatore di questa famiglia"
            : "Stai visualizzando la dispensa di famiglia come Membro"}
        </div>
      )}

      <SyncIssuesBanner />
      {composite.data?.partialFailures && composite.data.partialFailures.length > 0 && (
        <div className="px-4 pt-2">
          <div className="rounded-xl px-3 py-2 text-xs" style={{ backgroundColor: colors.amberLight, color: colors.inkMuted }}>
            Alcuni dati della schermata non sono disponibili al momento. Le sezioni mancanti verranno ricaricate automaticamente.
          </div>
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <nav
          className="hidden sm:flex flex-col w-56 shrink-0 py-6 px-3"
          style={{
            backgroundColor: colors.cream,
            borderRight: `1px solid ${colors.border}`,
          }}
        >
          <div className="px-3 mb-8">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">🫙</span>
              <span
                className="text-xl font-light"
                style={{ fontFamily: fonts.display, color: colors.ink }}
              >
                Dispensa
              </span>
            </div>
            <p
              className="text-[10px] mt-0.5"
              style={{ color: colors.inkMuted }}
            >
              {family.familyName}
            </p>
          </div>

          <div className="flex-1 space-y-0.5">
            {visibleNav.map((n) => {
              const isActive = currentTab === n.key;
              const badge = navBadge(n.key);

              return (
                <button
                  key={n.key}
                  onClick={() => setTab(n.key)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-all"
                  style={{
                    backgroundColor: isActive ? colors.creamDark : "transparent",
                    color: isActive ? colors.ink : colors.inkMuted,
                  }}
                >
                  <span className="text-base leading-none">{n.icon}</span>
                  <span className="flex-1">{n.label}</span>
                  {badge > 0 && (
                    <span
                      className="text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center"
                      style={{
                        backgroundColor: colors.terracotta,
                        color: colors.white,
                      }}
                    >
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <div
            className="mt-4 pt-4"
            style={{ borderTop: `1px solid ${colors.border}` }}
          >
            <div className="flex items-center gap-2.5 px-3 py-2">
              <AvatarUI initials={currentUser.avatar} size={8} />
              <div className="flex-1 min-w-0">
                <p
                  className="text-xs font-semibold truncate"
                  style={{ color: colors.ink }}
                >
                  {currentUser.name}
                </p>
                <p className="text-[10px]" style={{ color: colors.inkMuted }}>
                  {ROLE_LABELS[role]}
                </p>
              </div>
            </div>

            <button
              onClick={() => setShowLogoutConfirm(true)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-sm transition-all hover:opacity-80 mt-1"
              style={{ color: colors.inkMuted }}
            >
              <span className="text-base">🚪</span>
              <span className="text-xs font-medium">Esci</span>
            </button>
          </div>
        </nav>

        <main className="min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-4 pb-24 sm:p-6 sm:pb-6 lg:p-8">
          {currentTab === "oggi" && (
            <Oggi
              stock={stock}
              shopping={shoppingList}
              currentUserName={currentUser.name}
              onNavigate={(nextTab: string) => {
                if (ALL_NAV.some((n) => n.key === nextTab)) {
                  setTab(nextTab as Tab);
                }
              }}
              familyId={familyId}
              suggestedRecipes={composite.data?.suggestedRecipes}
            />
          )}

          {currentTab === "dispensa" && (
            <Dispensa
              stock={stock}
              setStock={setStock}
              readOnly={!canWrite}
            />
          )}

          {currentTab === "spesa" && (
            <Spesa
              list={shoppingList}
              setList={setShoppingList}
              currentUserName={currentUser.name}
            />
          )}

          {currentTab === "ricette" && (
            <Ricette
              stock={stock}
              setList={setShoppingList}
              familyId={familyId}
              suggestedRecipes={composite.data?.suggestedRecipes}
            />
          )}

          {currentTab === "nutrienti" && (
            <Nutrienti
              stock={stock}
              familyId={familyId}
              initialSummary={composite.data?.nutrition}
            />
          )}

          {currentTab === "famiglia" && (
            <Famiglia
              members={family.members}
              setMembers={family.setMembers}
              currentUserId={currentUser.id}
              canManage={canManage}
              isOwner={role === "OWNER"}
              onInviteCreated={family.syncInviteCreated}
              familyName={family.familyName}
              familyId={familyId}
            />
          )}

          {currentTab === "notifiche" && (
            <Notifiche
              notifications={notifications}
              setNotifications={setNotifications}
            />
          )}
        </main>
      </div>

      <MobileBottomNav
        items={visibleNav}
        currentTab={currentTab}
        onSelect={(nextTab) => setTab(nextTab as Tab)}
        getBadge={(key) => navBadge(key as Tab)}
      />

      {showLogoutConfirm && (
        <ConfirmModal
          title="Esci"
          message="Vuoi davvero uscire dall'account?"
          confirmLabel="Esci"
          onConfirm={handleLogout}
          onCancel={() => setShowLogoutConfirm(false)}
        />
      )}
    </div>
  );
}
