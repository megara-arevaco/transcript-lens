import { build } from "vite";
await build({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: { input: "sidepanel.html" },
  },
});
for (const [entry, name, format] of [
  ["src/content/index.ts", "content", "iife"],
  ["src/background/index.ts", "background", "es"],
]) {
  await build({
    publicDir: false,
    build: {
      outDir: "dist",
      emptyOutDir: false,
      lib: { entry, name, formats: [format], fileName: () => `${name}.js` },
    },
  });
}
