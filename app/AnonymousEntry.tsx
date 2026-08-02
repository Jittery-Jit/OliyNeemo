'use client'

import { useEffect, useState } from 'react'

async function prepareDeviceProfile() {
	const response = await fetch('/api/session', { method: 'POST' })
	const data = (await response.json()) as { error?: string }
	if (!response.ok) throw new Error(data.error || 'Neemo could not start.')
}

export default function AnonymousEntry() {
	const [message, setMessage] = useState('Preparing your private Neemo workspace…')
	const [failed, setFailed] = useState(false)

	const openNeemo = async () => {
		try {
			await prepareDeviceProfile()
			window.location.reload()
		} catch (error) {
			setFailed(true)
			setMessage(error instanceof Error ? error.message : 'Neemo could not start.')
		}
	}

	useEffect(() => {
		void prepareDeviceProfile()
			.then(() => window.location.reload())
			.catch((error: unknown) => {
				setFailed(true)
				setMessage(error instanceof Error ? error.message : 'Neemo could not start.')
			})
	}, [])

	return (
		<main className="auth-shell">
			<section className="auth-panel">
				<img className="brand" src="/neemo-logo.png" alt="Neemo" />
				<div className="auth-copy">
					<p className="eyebrow">One room. Every part.</p>
					<h1>Welcome to Neemo.</h1>
					<p>{message}</p>
				</div>
				{failed && (
					<button
						className="button primary"
						type="button"
						onClick={() => {
							setFailed(false)
							setMessage('Preparing your private Neemo workspace…')
							void openNeemo()
						}}
					>
						Try again
					</button>
				)}
				<p className="local-note">No Google account or sign-in is required.</p>
			</section>
			<section className="auth-visual" aria-label="Neemo workshop location illustration">
				<div className="auth-map-card">
					<span className="auth-hub h1">H</span>
					<span className="auth-hub h2">H</span>
					<span className="auth-hub h3">H</span>
					<span className="auth-target" />
					<p>Digital Calipers</p>
					<strong>Found · ±0.7 m</strong>
				</div>
			</section>
		</main>
	)
}
