import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const backblasts = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/backblasts' }),
  schema: z.object({
    slug: z.string(),
    title: z.string(),
    date: z.string(),
    ao: z.string().nullable().optional(),
    q: z.string().nullable().optional(),
    q_slug: z.string().nullable().optional(),
    pax: z.array(z.string()).default([]),
    total_pax: z.number().nullable().optional(),
    fngs: z.number().nullable().optional(),
    vault_path: z.string().optional(),
  }),
});

const pax = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/pax' }),
  schema: z.object({
    slug: z.string(),
    f3_name: z.string(),
    post_count: z.number().nullable().optional(),
    q_count: z.number().nullable().optional(),
    earliest_post: z.string().nullable().optional(),
    latest_post: z.string().nullable().optional(),
    aos: z.array(z.string()).default([]),
  }),
});

const aos = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './content/aos' }),
  schema: z.object({
    slug: z.string(),
    name: z.string(),
    // Optional flavor: what the AO name means / its story.
    meaning: z.string().optional(),
    // Where to physically show up.
    address: z.string().optional(),
    parking: z.string().optional(),
    // Used to build the "Get directions" link. Falls back to `address`.
    map_query: z.string().optional(),
    // When it meets. `days` drives the schedule line; `time` is start time.
    days: z.array(z.string()).default([]),
    time: z.string().optional(),
    // Bootcamp / running / ruck / etc.
    style: z.string().optional(),
    // Site Q (point man) — F3 name only, no contact info on the public site.
    site_q: z.string().optional(),
    // First-timer reassurance specific to this AO.
    what_to_expect: z.string().optional(),
    // Optional hero photo for the AO card, relative to /public.
    photo: z.string().optional(),
    // Sort order on the locations page (lower = first).
    order: z.number().default(0),
  }),
});

export const collections = { backblasts, pax, aos };
