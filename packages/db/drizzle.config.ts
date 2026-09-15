import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./src/schema.ts', './src/cms-schema.ts', './src/commerce-schema.ts'],
  out: './migrations',
  dbCredentials: {
    url:
      process.env.DATABASE_URL ?? 'postgresql://placeholder:placeholder@127.0.0.1:5432/placeholder',
  },
  strict: true,
  verbose: true,
});
