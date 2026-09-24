import { useState, useEffect } from "react";
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
import { isBackendUnreachable } from "./api/client";

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

type Tab = "oggi" | "dispensa" | "spesa" | "ricette" | "nutrienti" | "famiglia" | "notifiche";

const CAN_WRITE: Role[] = ["OWNER", "MANAGER", "MEMBER"];
const CAN_MANAGE_FAMILY: Role[] = ["OWNER", "MANAGER"];

/**
 * Session persistence. The backend has no session/cookie concept for this login (see
 * pages/auth/Login.tsx — password grant contro Keycloak via OIDC), so the app keeps the
 * signed-in user in localStorage itself — enough to survive a page refresh. Il refresh del
 * token è gestito trasparentemente da client.ts (single-flight); lo store qui sotto riflette
 * solo lo stato osservabile.
 */
export default function App() {
  const [screen, setScreen] = useState<AuthScreen>("login");
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [tab, setTab] = useState<Tab>("oggi");
  const [sessionChecked, setSessionChecked] = useState(false);

  // Restore a previous session on first load.
  const authToken = useAuthStore((s) => s.token);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!authToken) {
        // Il token è null (mai loggato, oppure SESSION_EXPIRED_EVENT ha appena svuotato lo
        // store): torniamo al login e resettiamo lo stato derivato.
        if (!cancelled) {
          setCurrentUser(null);
          setScreen("login");
          setSessionChecked(true);
        }
        return;
      }
      try {
        const apiUser = await getCurrentUser();
        const families = await listFamilies();
        const active = apiUser.activeFamilyId
          ? families.families.find((f) => f.familyId === apiUser.activeFamilyId)
          : families.families[0];
        const user: AuthUser = {
          id: apiUser.id,
          name: apiUser.name || apiUser.preferredUsername || apiUser.email || "Utente",
          email: apiUser.email || "",
          avatar: (apiUser.name || apiUser.preferredUsername || "U").slice(0, 2).toUpperCase(),
          role: (active?.role as Role) || "OWNER",
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
            // Backend momentaneamente irraggiungibile: NON e' un segnale che il token sia
            // invalido. Manteniamo la sessione (e il token) cosi' com'e' e lasciamo che l'utente
            // riprovi/rimanga sulla schermata corrente; gli hook dei dati (useInventory, ecc.)
            // gestiscono gia' la modalita' demo/offline per i singoli pannelli.
            setSessionChecked(true);
            return;
          }
          // Il token persistito non e' (piu') valido: svuotiamo lo store. Il middleware
          // `persist` aggiorna anche localStorage, così un token rotto non resta salvato
          // e non causa un loop di re-render.
          useAuthStore.setState({ token: null, refreshToken: null, expiresAt: null, user: null, isAuthenticated: false });
          setCurrentUser(null);
          setScreen("login");
          setSessionChecked(true);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [authToken]);

  // Real backend data (falls back to demo data automatically — see hooks/useInventory.ts and
  // hooks/useShoppingList.ts for exactly what's wired to which endpoint and why).
  //
  // IMPORTANTE: `familyId` è null quando `authToken` è null, anche se `currentUser` non è
  // ancora stato azzerato dal setState dell'effect sopra. Questo evita che gli hook partano
  // con un `familyId` valorizzato prima che il token sia effettivamente disponibile: senza
  // questo guard, al momento di un refresh fallito si vedrebbe una cascata di 401 su
  // /families, /inventory, /shopping-lists, tutti lanciati con Authorization assente.
  const familyId = authToken !== null ? (currentUser?.hasFamilyId ?? null) : null;
  const inventory = useInventory(familyId);
  const shopping = useShoppingList(familyId);
  const family = useFamilyMembers(familyId);
  const stock = inventory.stock;
  const setStock = inventory.setStock;
  const shoppingList = shopping.list;
  const setShoppingList = shopping.setList;

  const notificationState = useNotifications(familyId);
  const notifications = notificationState.notifications;
  const setNotifications = notificationState.setNotifications;

  const [isOffline, setIsOffline] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  useEffect(() => {
    const onOnline = () => setIsOffline(false);
    const onOffline = () => setIsOffline(true);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => { window.removeEventListener("online", onOnline); window.removeEventListener("offline", onOffline); };
  }, []);

  function handleLogin(user: AuthUser) {
    setCurrentUser(user);
    if (user.hasFamilyId) { setScreen("app"); }
    else { setScreen("onboarding"); }
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
    // Password grant contro Keycloak: non c'è una "sessione server" da invalidare. Il client
    // ha solo l'access/refresh token; buttarli via basta. Keycloak ha una sua SSO session
    // separata che scade da sola, ma finché non chiami /logout su Keycloak resta valida — non
    // è un problema per il nostro caso d'uso (una famiglia in locale).
    useAuthStore.getState().clearToken();
    setCurrentUser(null);
    setScreen("login");
    setTab("oggi");
    setShowLogoutConfirm(false);
  }

  // Don't render the auth/app shell until we've checked for a persisted session, to avoid a
  // flash of the login screen for a user who's actually already signed in.
  if (!sessionChecked) return null;

  // ── Auth screens ─────────────────────────────────────────────────────────────
  if (screen === "login") return <Login onLogin={handleLogin} onRegister={() => setScreen("register")} onForgot={() => setScreen("forgot")} />;
  if (screen === "register") return <Register onRegistered={handleRegistered} onLogin={() => setScreen("login")} />;
  if (screen === "forgot") return <ForgotPassword onBack={() => setScreen("login")} />;
  if (screen === "onboarding" && currentUser) return <Onboarding user={currentUser} onComplete={handleOnboardingComplete} />;

  if (!currentUser) return null;

  const role = currentUser.role;
  const canWrite = CAN_WRITE.includes(role);
  const canManage = CAN_MANAGE_FAMILY.includes(role);

  const expiredCount = stock.filter((s) => { const d = expiryDays(s.batches); return d !== null && d <= 0; }).length;
  const expiringCount = stock.filter((s) => { const d = expiryDays(s.batches); return d !== null && d > 0 && d <= 5; }).length;
  const unreadNotifs = notifications.filter((n) => !n.readAt).length;
  const urgentBadge = expiredCount + expiringCount;

  const ALL_NAV: { key: Tab; label: string; icon: string; roles?: Role[] }[] = [
    { key: "oggi", label: "Oggi", icon: "🏠" },
    { key: "dispensa", label: "Dispensa", icon: "🏺" },
    { key: "spesa", label: "Spesa", icon: "🛒" },
    { key: "ricette", label: "Ricette", icon: "👨‍🍳" },
    { key: "nutrienti", label: "Nutrienti", icon: "📊" },
    { key: "famiglia", label: "Famiglia", icon: "👥" },
    { key: "notifiche", label: "Notifiche", icon: "🔔" },
  ];

  // VIEWER sees only oggi, dispensa, ricette, nutrienti
  const visibleNav = role === "VIEWER"
    ? ALL_NAV.filter((n) => ["oggi", "dispensa", "ricette", "nutrienti", "notifiche"].includes(n.key))
    : ALL_NAV;

  // If current tab is hidden for this role, redirect to oggi
  const currentTab = visibleNav.find((n) => n.key === tab) ? tab : "oggi";

  function navBadge(key: Tab) {
    if (key === "oggi" && urgentBadge > 0) return urgentBadge;
    if (key === "notifiche" && unreadNotifs > 0) return unreadNotifs;
    return 0;
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: colors.cream, fontFamily: "var(--font-sans)" }}>
      {/* Offline banner */}
      {isOffline && (
        <div className="px-4 py-2 text-center text-xs font-medium" style={{ backgroundColor: colors.amberLight, color: colors.amberDark }}>
          Sei offline. Le modifiche verranno sincronizzate appena torni online.
        </div>
      )}

      {/* Role badge for non-owner */}
      {role !== "OWNER" && role !== "MANAGER" && (
        <div
          className="px-4 py-2 text-center text-xs font-medium"
          style={{ backgroundColor: role === "VIEWER" ? colors.creamDark : colors.sageLight, color: role === "VIEWER" ? colors.inkMuted : colors.sageDark }}
        >
          {role === "VIEWER" ? "Modalità sola lettura — sei un visualizzatore di questa famiglia" : "Stai visualizzando la dispensa di famiglia come Membro"}
        </div>
      )}

      {/* Background sync failures (conflicts, offline retries) */}
      <SyncIssuesBanner />

      <div className="flex flex-1 min-h-0">
        {/* ── Desktop sidebar ────────────────────────────────────────────────── */}
        <nav
          className="hidden sm:flex flex-col w-56 shrink-0 py-6 px-3"
          style={{ backgroundColor: colors.cream, borderRight: `1px solid ${colors.border}` }}
        >
          {/* Logo */}
          <div className="px-3 mb-8">
            <div className="flex items-center gap-2.5">
              <span className="text-2xl">🫙</span>
              <span className="text-xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>Dispensa</span>
            </div>
            <p className="text-[10px] mt-0.5" style={{ color: colors.inkMuted }}>Famiglia Ferretti</p>
          </div>

          {/* Nav */}
          <div className="flex-1 space-y-0.5">
            {visibleNav.map((n) => {
              const isActive = currentTab === n.key;
              const badge = navBadge(n.key);
              return (
                <button
                  key={n.key}
                  onClick={() => setTab(n.key)}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-left text-sm font-medium transition-all"
                  style={{ backgroundColor: isActive ? colors.creamDark : "transparent", color: isActive ? colors.ink : colors.inkMuted }}
                >
                  <span className="text-base leading-none">{n.icon}</span>
                  <span className="flex-1">{n.label}</span>
                  {badge > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[18px] text-center" style={{ backgroundColor: colors.terracotta, color: colors.white }}>
                      {badge}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {/* User + logout */}
          <div className="mt-4 pt-4" style={{ borderTop: `1px solid ${colors.border}` }}>
            <div className="flex items-center gap-2.5 px-3 py-2">
              <AvatarUI initials={currentUser.avatar} size={8} />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold truncate" style={{ color: colors.ink }}>{currentUser.name}</p>
                <p className="text-[10px]" style={{ color: colors.inkMuted }}>{ROLE_LABELS[role]}</p>
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

        {/* ── Main content ─────────────────────────────────────────────────── */}
        <main className="flex-1 overflow-y-auto">
          {/* Mobile top bar */}
          <div className="sm:hidden flex items-center justify-between px-4 py-3 sticky top-0 z-30" style={{ backgroundColor: colors.cream, borderBottom: `1px solid ${colors.border}` }}>
            <div className="flex items-center gap-2">
              <span className="text-xl">🫙</span>
              <span className="font-light text-base" style={{ fontFamily: fonts.display, color: colors.ink }}>Dispensa</span>
            </div>
            <div className="flex items-center gap-3">
              {unreadNotifs > 0 && (
                <button onClick={() => setTab("notifiche")} className="relative">
                  <span className="text-xl">🔔</span>
                  <span className="absolute -top-1 -right-1 text-[9px] font-bold px-1 rounded-full" style={{ backgroundColor: colors.terracotta, color: colors.white }}>{unreadNotifs}</span>
                </button>
              )}
              <button onClick={() => setShowLogoutConfirm(true)}>
                <AvatarUI initials={currentUser.avatar} size={7} />
              </button>
            </div>
          </div>

          <div className="max-w-3xl mx-auto px-4 py-6 pb-28 sm:pb-8">
            {currentTab === "oggi" && <Oggi stock={stock} shopping={shoppingList} currentUserName={currentUser.name} familyId={familyId} onNavigate={(t) => setTab(t as Tab)} />}
            {currentTab === "dispensa" && <Dispensa stock={stock} setStock={canWrite ? setStock : () => {}} readOnly={!canWrite} />}
            {currentTab === "spesa" && canWrite && <Spesa list={shoppingList} setList={setShoppingList} currentUserName={currentUser.name} />}
            {currentTab === "spesa" && !canWrite && <ReadOnlySpesa list={shoppingList} />}
            {currentTab === "ricette" && <Ricette stock={stock} setList={canWrite ? setShoppingList : () => {}} familyId={familyId} />}
            {currentTab === "nutrienti" && <Nutrienti stock={stock} familyId={familyId} />}
            {currentTab === "famiglia" && (
              <Famiglia
                members={family.members}
                setMembers={family.setMembers}
                currentUserId={currentUser.id}
                canManage={canManage}
                isOwner={role === "OWNER"}
                onInviteCreated={family.syncInviteCreated}
                familyName={family.familyName}
              />
            )}
            {currentTab === "notifiche" && <Notifiche notifications={notifications} setNotifications={setNotifications} />}
          </div>
        </main>
      </div>

      {/* ── Mobile bottom nav ──────────────────────────────────────────────── */}
      <nav
        className="sm:hidden fixed bottom-0 left-0 right-0 flex items-center justify-around px-1 py-1.5"
        style={{ backgroundColor: colors.cream, borderTop: `1px solid ${colors.border}`, zIndex: 40 }}
      >
        {visibleNav.map((n) => {
          const isActive = currentTab === n.key;
          const badge = navBadge(n.key);
          return (
            <button
              key={n.key}
              onClick={() => setTab(n.key)}
              className="flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-xl transition-all relative"
              style={{ color: isActive ? colors.terracotta : colors.inkMuted, minWidth: "44px", minHeight: "44px", justifyContent: "center" }}
              aria-label={n.label}
            >
              <span className="text-lg leading-none">{n.icon}</span>
              <span className="text-[9px] font-medium">{n.label}</span>
              {badge > 0 && (
                <span className="absolute top-0.5 right-0 text-[8px] font-bold px-1 py-0.5 rounded-full leading-none" style={{ backgroundColor: colors.terracotta, color: colors.white }}>
                  {badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {showLogoutConfirm && (
        <ConfirmModal
          title="Esci dall'account?"
          message={`Stai per uscire come ${currentUser.name}. Dovrai accedere di nuovo.`}
          confirmLabel="Esci"
          destructive
          onConfirm={handleLogout}
          onCancel={() => setShowLogoutConfirm(false)}
        />
      )}
    </div>
  );
}

// ── Read-only spesa for VIEWER ─────────────────────────────────────────────────
function ReadOnlySpesa({ list }: { list: ShoppingList }) {
  return (
    <div className="space-y-5">
      <h2 className="text-2xl font-light" style={{ fontFamily: fonts.display, color: colors.ink }}>{list.name}</h2>
      <div className="rounded-xl px-4 py-3 text-sm" style={{ backgroundColor: colors.creamDark, color: colors.inkMuted }}>
        Sei un visualizzatore — puoi vedere la lista ma non modificarla.
      </div>
      <div className="rounded-2xl overflow-hidden" style={{ border: `1px solid ${colors.border}` }}>
        {list.items.filter((i) => i.state !== "IGNORED").map((item, idx, arr) => (
          <div
            key={item.id}
            className="flex items-center gap-3 px-4 py-3"
            style={{ backgroundColor: idx % 2 === 0 ? colors.white : colors.creamMid, borderBottom: idx < arr.length - 1 ? `1px solid ${colors.borderLight}` : "none", opacity: item.state === "COMPLETED" ? 0.45 : 1 }}
          >
            <div className="w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center" style={{ borderColor: item.state === "COMPLETED" ? colors.sage : colors.border, backgroundColor: item.state === "COMPLETED" ? colors.sage : "transparent" }}>
              {item.state === "COMPLETED" && <span className="text-white text-[8px]">✓</span>}
            </div>
            <span className="text-sm" style={{ color: colors.ink, textDecoration: item.state === "COMPLETED" ? "line-through" : "none" }}>{item.displayName}</span>
            <span className="text-xs ml-auto" style={{ color: colors.inkMuted }}>{item.quantity} {item.unit}</span>
          </div>
        ))}
      </div>
    </div>
  );
}