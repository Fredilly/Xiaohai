import { seedLocalStaff } from './local-staff-seed.js';

try {
  const result = await seedLocalStaff();
  console.log('Local Staff/RBAC seed completed.');
  console.log(
    `HQ: ${result.hqLoginIdentifier} · GLOBAL · ${result.hqPermissionCount} permissions`,
  );
  console.log(
    `Store: ${result.storeLoginIdentifier} · ${result.storeName} (${result.storeId}) · ${result.storePermissionCount} permissions`,
  );
  console.log(
    'Passwords were read from environment variables and were not printed or persisted in source.',
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local Staff/RBAC seed failed');
  process.exitCode = 1;
}
