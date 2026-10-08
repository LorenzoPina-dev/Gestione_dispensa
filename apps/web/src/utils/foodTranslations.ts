export const FOOD_TRANSLATIONS_IT: Readonly<Record<string, string>> = {
  "blue cheese":"formaggio erborinato","blue cheeses":"formaggi erborinati",
  "olives":"olive","olive":"olive","black pepper":"pepe nero","white pepper":"pepe bianco",
  "cream":"panna","heavy cream":"panna","whipping cream":"panna da montare","sour cream":"panna acida",
  "cream cheese":"formaggio spalmabile","olive oil":"olio d'oliva",
  "extra virgin olive oil":"olio extravergine d'oliva","extra-virgin olive oil":"olio extravergine d'oliva",
  "breadcrumbs":"pangrattato","bread crumbs":"pangrattato","baking powder":"lievito per dolci",
  "all-purpose flour":"farina 00","plain flour":"farina","powdered sugar":"zucchero a velo",
  "icing sugar":"zucchero a velo","brown sugar":"zucchero di canna","chicken breast":"petto di pollo",
  "chicken breasts":"petti di pollo","chicken thigh":"coscia di pollo","chicken thighs":"cosce di pollo",
  "ground beef":"carne macinata di manzo","beef mince":"carne macinata di manzo",
  "ground pork":"carne macinata di maiale","canned tomatoes":"pomodori pelati",
  "tinned tomatoes":"pomodori pelati","tomato paste":"concentrato di pomodoro","tomato sauce":"passata di pomodoro"
};

export function translateFoodText(value: unknown, locale = "it-IT"): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (!raw || !/^it(?:-|$)/i.test(locale)) return raw;
  return FOOD_TRANSLATIONS_IT[raw.toLowerCase()] ?? raw;
}
