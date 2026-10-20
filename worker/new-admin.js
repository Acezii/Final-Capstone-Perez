const crypto = require("crypto");

const username = process.argv[2];
const password = process.argv[3];
const fullName = process.argv[4] || "CCS Staff";

if (!username || !password) {
  console.log('Usage: node new-admin.js <username> <password> "<Full Name>"');
  process.exit(1);
}

const salt = crypto.randomBytes(16);
const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, "sha256").toString("hex");

console.log(
  `INSERT INTO admins (username, full_name, role, password_hash, password_salt) VALUES ('${username}', '${fullName}', 'staff', '${hash}', '${salt.toString("hex")}');`
);
