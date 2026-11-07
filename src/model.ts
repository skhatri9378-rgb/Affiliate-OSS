import { z } from "zod";
export interface SavedLabel {
  id: string;
  name: string;
  archived: boolean;
  linkCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface AffiliateLink {
  id: string;
  name: string;
  countryId: string;
  websiteId: string;
  siteId?: string | null;
  placement: string;
  url: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  countryName: string;
  websiteName: string;
  siteName?: string | null;
  siteArchived?: boolean | null;
  countryArchived: boolean;
  websiteArchived: boolean;
  healthStatus?: "working" | "review" | "broken" | null;
  healthCheckedAt?: string | null;
  healthHttpStatus?: number | null;
  healthDetail?: string | null;
}
export interface LinkInput {
  id?: string;
  name: string;
  countryId: string;
  websiteId: string;
  siteId?: string | null;
  placement: string;
  url: string;
  notes: string;
}
export interface Snapshot {
  countries: SavedLabel[];
  websites: SavedLabel[];
  sites: SavedLabel[];
  links: AffiliateLink[];
  total: number;
  metrics: { links: number; countries: number; websites: number };
  recent: AffiliateLink[];
}
export interface Query {
  search: string;
  countryId: string;
  websiteId: string;
  siteId?: string | null;
  offset: number;
}
export type Kind = "countries" | "websites" | "sites";
export const empty: Snapshot = {
  countries: [],
  websites: [],
  sites: [],
  links: [],
  total: 0,
  metrics: { links: 0, countries: 0, websites: 0 },
  recent: [],
};
export const linkSchema = z.object({
  name: z.string().trim().min(1, "App name is required.").max(200),
  countryId: z.string().min(1, "Choose a country."),
  websiteId: z.string().min(1, "Choose a channel/project."),
  siteId: z.string().min(1, "Choose a website."),
  url: z
    .string()
    .min(1, "Affiliate URL is required.")
    .max(20000)
    .refine((value) => {
      try {
        const u = new URL(value);
        return (
          ["https:", "http:"].includes(u.protocol) &&
          !!u.hostname &&
          value.trim() === value
        );
      } catch {
        return false;
      }
    }, "Use a complete HTTP or HTTPS URL without surrounding spaces."),
  placement: z.string().max(2000),
  notes: z.string().max(20000),
});
export const blankLink = (): LinkInput => ({
  name: "",
  countryId: "",
  websiteId: "",
  siteId: "",
  placement: "",
  url: "",
  notes: "",
});
export const formatDate = (date: string) =>
  new Date(date).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
