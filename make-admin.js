/**
 * Builds the wrangler command that creates a FieldOps login.
 *
 *   node make-admin.js "Full Name" username password [super]
 *
 * Examples
 *   node make-admin.js "Rahul Jaiswal" rahul Secret123
 *   node make-admin.js "Jay Gupta" jay Secret123 super     <- can cancel/decline
 *
 * The password is hashed here exactly the way the API hashes it
 * (PBKDF2-SHA256, 100000 iterations, 16-byte salt), so nothing in plain text
 * ever reaches the database.
 */
const crypto = require('crypto');

const [name, usernameRaw, password, flag] = process.argv.slice(2);

if (!name || !usernameRaw || !password) {
  console.error('Usage: node make-admin.js "Full Name" username password [super]');
  process.exit(1);
}
if (password.length < 6) {
  console.error('Password needs at least 6 characters.');
  process.exit(1);
}

const username = usernameRaw.trim().toLowerCase();
const isSuper = String(flag || '').toLowerCase() === 'super' ? 1 : 0;

const saltHex = crypto.randomBytes(16).toString('hex');
const digest = crypto
  .pbkdf2Sync(password, Buffer.from(saltHex, 'hex'), 100000, 32, 'sha256')
  .toString('hex');
const hash = `pbkdf2$100000$${saltHex}$${digest}`;

const sql =
  `INSERT INTO users (username, password_hash, role, name, is_super) ` +
  `VALUES ('${username}', '${hash}', 'admin', '${name.replace(/'/g, "''")}', ${isSuper})`;

console.log('');
console.log(`  Name      ${name}`);
console.log(`  Username  ${username}`);
console.log(`  Password  ${password}`);
console.log(`  Role      ${isSuper ? 'admin (superadmin — can cancel and decline)' : 'admin'}`);
console.log('');
console.log('Run this:');
console.log('');
console.log(`npx wrangler d1 execute fieldops --remote --command="${sql}"`);
console.log('');
