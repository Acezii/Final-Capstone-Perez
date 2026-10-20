import crypto from "node:crypto";

const [username, password, fullName = "CCS Staff"] = process.argv.slice(2);

if (!username || !password) {
  console.error('Usage: node reset-admin.mjs <username> <new-password> "<Full Name>"');
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex");
const quote = (value) => `'${String(value).replaceAll("'", "''")}'`;

console.log(`UPDATE admins SET full_name = ${quote(fullName)}, password_hash = ${quote(hash)}, password_salt = ${quote(salt.toString("hex"))} WHERE username = ${quote(username)};`);
