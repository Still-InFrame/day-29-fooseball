import type { MetadataRoute } from "next";

// Web app manifest — makes fooseball installable ("Add to Home Screen").
// Launched from the home-screen icon, it opens standalone: no URL bar, no tabs.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "fooseball",
    short_name: "fooseball",
    description: "Old-school real-time 2-player foosball. First to 5 wins.",
    start_url: "/",
    display: "standalone",
    background_color: "#07140d",
    theme_color: "#07140d",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
