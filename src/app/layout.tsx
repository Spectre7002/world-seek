import type { Metadata, Viewport } from "next";
import { Jersey_25, Jersey_10 } from "next/font/google";
import "./globals.css";
import ClickSound from "@/components/ClickSound";

// Pixel/arcade display — big stamped game-title headings. Single 400 weight.
const display = Jersey_25({
  subsets: ["latin"],
  weight: "400",
  variable: "--ff-display",
  display: "swap",
});

// Pixel/arcade display — used for body copy, eyebrows, UI labels, and buttons.
// Jersey 10 ships a single 400 weight (no bold).
const body = Jersey_10({
  subsets: ["latin"],
  weight: "400",
  variable: "--ff-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "World Seek",
  description: "Hide somewhere in the world. Let your friends find you on Street View.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        {children}
        <ClickSound />
      </body>
    </html>
  );
}
