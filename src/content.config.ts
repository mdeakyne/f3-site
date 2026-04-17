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

export const collections = { backblasts, pax };
