import type { Metadata } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { headers } from 'next/headers'
import './globals.css'

const geistSans = Geist({
	variable: '--font-geist-sans',
	subsets: ['latin'],
})

const geistMono = Geist_Mono({
	variable: '--font-geist-mono',
	subsets: ['latin'],
})

export async function generateMetadata(): Promise<Metadata> {
	const requestHeaders = await headers()
	const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host') ?? 'localhost:43761'
	const protocol = requestHeaders.get('x-forwarded-proto') ?? (host.includes('localhost') ? 'http' : 'https')
	const base = new URL(`${protocol}://${host}`)
	const image = new URL('/og.png', base).toString()

	return {
		title: 'Neemo — Find every part',
		description: 'A bright, simple workspace for teams to label, search, and locate tagged tools and parts.',
		metadataBase: base,
		manifest: '/manifest.webmanifest',
		icons: {
			icon: [
				{
					url: '/neemo-favicon-64.png',
					sizes: '64x64',
					type: 'image/png',
				},
				{
					url: '/neemo-icon-192.png',
					sizes: '192x192',
					type: 'image/png',
				},
			],
			apple: [
				{
					url: '/neemo-icon-192.png',
					sizes: '192x192',
					type: 'image/png',
				},
			],
		},
		appleWebApp: {
			capable: true,
			statusBarStyle: 'default',
			title: 'Neemo',
		},
		openGraph: {
			title: 'Neemo — Find every part',
			description: 'Label it. Search it. Locate it in seconds.',
			type: 'website',
			images: [{ url: image, width: 1200, height: 630, alt: 'Neemo finds tagged parts in a robotics workshop' }],
		},
		twitter: {
			card: 'summary_large_image',
			title: 'Neemo — Find every part',
			description: 'Label it. Search it. Locate it in seconds.',
			images: [image],
		},
	}
}

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode
}>) {
	return (
		<html lang="en">
			<body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>{children}</body>
		</html>
	)
}
