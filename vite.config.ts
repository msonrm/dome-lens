import { defineConfig } from "vite";

// GitHub Pages のサブパス（/dome-lens/）でも動くように相対パスで出力する
export default defineConfig({
  base: "./",
});
