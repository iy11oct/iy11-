import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "图片转拼豆图纸",
  description: "上传图片，选择尺寸，生成 MARD 221 色拼豆图纸并保存。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
