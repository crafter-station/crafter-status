import { ClerkProvider } from "@clerk/nextjs";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
	title: "Crafter Status",
	description: "Daily summaries for the team's WhatsApp groups.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
	return (
		<ClerkProvider>
			<html lang="en">
				<body>{children}</body>
			</html>
		</ClerkProvider>
	);
}
