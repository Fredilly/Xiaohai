import { createDatabase } from './client.js';
import { seedStagingHome } from './seed-staging-home.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to run staging seed in production.');
}

const database = createDatabase(process.env);
try {
  const result = await seedStagingHome(database.db);
  if (result.seeded) {
    console.log(
      `Staging home seed complete: ${result.sectionCount} CMS sections, ${result.bookCount} books.`,
    );
  } else if (result.reason === 'ALREADY_SEEDED') {
    console.log('Staging home seed already applied; skipping.');
  } else if (result.reason === 'CMS_ALREADY_CONFIGURED') {
    console.log('Home CMS already has custom content; leaving unchanged.');
  } else {
    console.log(`Staging home seed skipped: ${result.reason}`);
  }
} finally {
  await database.pool.end();
}
