const fs = require("fs");

// 1. Lấy chuỗi JSON từ biến môi trường
const configString = process.env.FIREBASE_CONFIG_JSON;

if (!configString) {
  console.error("❌ Error: FIREBASE_CONFIG_JSON is missing!");
  process.exit(1);
}

try {
  // 2. Parse chuỗi JSON thành Object
  const configObj = JSON.parse(configString);

  // 3. Tạo nội dung file TypeScript
  // JSON.stringify sẽ tự động format object thành chuỗi hợp lệ
  const content = `export const firebaseConfig = ${JSON.stringify(
    configObj,
    null,
    2
  )};`;

  // 4. Ghi file
  const targetPath = "./src/environments/firebase.config.ts";
  fs.writeFileSync(targetPath, content);

  console.log(`✅ File generated successfully at: ${targetPath}`);
} catch (error) {
  console.error("❌ Error parsing JSON config:", error);
  process.exit(1);
}
