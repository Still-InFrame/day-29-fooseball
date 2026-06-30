import type { Metadata } from "next";
import { Press_Start_2P } from "next/font/google";
import "./globals.css";

const arcade = Press_Start_2P({
  variable: "--font-arcade",
  weight: "400",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "fooseball — real-time foosball",
  description: "Old-school real-time 2-player foosball. Grab a room code, find a friend, first to 5 wins.",
  openGraph: {
    title: "fooseball — real-time foosball",
    description: "Old-school real-time 2-player foosball. Share a room code and play a friend — first to 5 wins.",
    type: "website",
  },
  twitter: {
    card: "summary",
    title: "fooseball — real-time foosball",
    description: "Old-school real-time 2-player foosball. Share a room code and play a friend.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${arcade.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
