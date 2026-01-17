const fs = require("fs");
const path = require("path"); 
require("dotenv").config();

// 2. Đường dẫn file đích
const targetPath = "./src/environments/firebase.config.ts";
 
const configString = process.env.FIREBASE_CONFIG_JSON;
 
if (!configString) { 
  if (fs.existsSync(targetPath)) { 
    console.log("⚠️  FIREBASE_CONFIG_JSON missing. Using existing local file.");
    process.exit(0);
  } else { 
    console.error(
      "❌ Error: FIREBASE_CONFIG_JSON is missing and no local file found!"
    );
    process.exit(1);
  }
}

try {
  // 5. Parse và Ghi file
  const configObj = JSON.parse(configString);
  const content = `export const firebaseConfig = ${JSON.stringify(
    configObj,
    null,
    2
  )};`;

  // Đảm bảo thư mục tồn tại trước khi ghi
  const dir = path.dirname(targetPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(targetPath, content);
  console.log(`✅ Environment file generated correctly at ${targetPath}`);
} catch (error) {
  console.error("❌ Error parsing JSON config:", error);
  process.exit(1);
}
