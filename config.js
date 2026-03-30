const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// Persist JWT secret so sessions survive server restarts
const secretPath = path.join(__dirname, '.jwt_secret');
let JWT_SECRET;

if (process.env.JWT_SECRET) {
  JWT_SECRET = process.env.JWT_SECRET;
} else if (fs.existsSync(secretPath)) {
  JWT_SECRET = fs.readFileSync(secretPath, 'utf8').trim();
} else {
  JWT_SECRET = crypto.randomBytes(64).toString('hex');
  fs.writeFileSync(secretPath, JWT_SECRET, { mode: 0o600 });
}

module.exports = { JWT_SECRET };
