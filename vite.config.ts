import { defineConfig } from "vite";
import { resolve } from "node:path";

// GitHub Pages のサブパス（/dome-lens/）でも動くように相対パスで出力する
export default defineConfig({
  base: "./",
  build: {
    rolldownOptions: {
      input: {
        main: resolve(import.meta.dirname, "index.html"),
        sphere: resolve(import.meta.dirname, "sphere.html"),
      },
    },
  },
});
