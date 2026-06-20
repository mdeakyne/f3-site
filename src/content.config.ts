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
    // When it meets.
    day: z.string().optional(),
    time: z.string().optional(),
    // Where to physically show up + the directions link.
    address: z.string().optional(),
    map_url: z.string().optional(),
    // Bootcamp / running / ruck / etc.
    workout_type: z.string().optional(),
    // Site Q (point man). F3 name only, no contact info on the public site.
    site_q: z.string().optional(),
    site_q_slug: z.string().optional(),
    // Optional flavor: what the AO name means / its story.
    meaning: z.string().optional(),
    // Optional hero photo for the AO card, relative to /public.
    photo: z.string().optional(),
  }),
});

export const collections = { backblasts, pax, aos };
