import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// GitHub Actions のワークフロー内で BASE_PATH を "/リポジトリ名/" として渡します。
// ローカルで `npm run dev` する場合は未設定でも問題ありません（"/"になります）。
export default defineConfig({
  plugins: [react()],
  base: process.env.BASE_PATH || "/",
});
