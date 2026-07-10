import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Waybills — Kaspi Доставка",
  description: "Сборка накладных для склада",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
