// 1:1 port of src/part_app_1.js#CATEGORY_SKILL + the `rec.skill = rec.skill ||
// CATEGORY_SKILL[rec.category] || "General"` derivation. No prompt record in
// the actual data carries an explicit `skill` override (verified against the
// full seed export), so this is purely a function of `category` today — kept
// as a lookup (not folded into a 1:1 category alias) so an admin adding a new
// category with no mapping degrades to "General" exactly like legacy.
export const CATEGORY_SKILL: Record<string, string> = {
  "AI & Prompt Engineering": "Prompt Engineering",
  "Marketing & Branding": "Marketing Strategy",
  "HR & Recruiting": "People & Hiring",
  "Social Media": "Social Media",
  "Customer Support": "Customer Communication",
  "Sales & Lead Generation": "Sales",
  "Content Writing & Copywriting": "Copywriting",
  "Business Strategy": "Strategic Thinking",
  "Coding & Tech": "Technical",
  "Education & Learning": "Instructional Design",
  "Finance & Accounting": "Financial Analysis",
  "Product Management": "Product Management",
  "Research & Data Analysis": "Research & Analysis",
  "Email Marketing": "Lifecycle Marketing",
  "SEO & Analytics": "SEO & Analytics",
  "Career Growth": "Career Development",
  "Coaching & Self-Development": "Coaching",
  "Communication & Leadership": "Leadership Communication",
  "Legal & Compliance": "Legal & Compliance",
  "Health & Fitness": "Health & Wellbeing",
  "E-Commerce": "E-Commerce",
  "Presentation & Slides": "Presentation Design",
  "Book & Ebook Writing": "Long-form Writing",
  "Productivity & Automation": "Productivity",
  "UX/UI Design": "UX/UI Design",
  "Image & Design": "Visual Design",
  "Spirituality & Wellness": "Wellbeing",
  General: "General",
};

export function skillFor(category: string | null | undefined): string {
  return (category && CATEGORY_SKILL[category]) || "General";
}
