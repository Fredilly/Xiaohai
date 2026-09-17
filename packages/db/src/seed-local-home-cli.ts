import { createDatabase } from './client.js';
import { seedLocalHomeCms } from './seed-local-home.js';

if (process.env.NODE_ENV === 'production') {
  throw new Error('Refusing to seed local Home CMS defaults in production.');
}

const database = createDatabase(process.env);

try {
  const result = await seedLocalHomeCms(database.db);
  if (result.seeded) {
    console.log(`Seeded ${result.count} local Home CMS sections.`);
  } else if (result.reason === 'CMS_ALREADY_CONFIGURED') {
    console.log('Home CMS already has sections; leaving existing CMS content unchanged.');
  } else {
    console.log('HOME CMS page is missing; no local Home defaults were seeded.');
  }
} finally {
  await database.pool.end();
}
