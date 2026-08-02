'use client'

import type { DemoModeSnapshot, DemoTagReading } from '../MqttDemoMode'
import { DEMO_FRESHNESS, lastSeenLabel, tagFreshness } from '../lib/freshness'
import { IconActivity, IconBroadcast, IconClock, IconHub, IconTerminal } from './icons'

type CurrentReading = Readonly<{
	tagId: string
	reading: DemoTagReading
	seenAt: number
}>

function currentReadings(snapshot: DemoModeSnapshot): readonly CurrentReading[] {
	if (snapshot.scannerStatus !== 'publishing') return []
	return Object.entries(snapshot.seenTags)
		.flatMap(([tagId, reading]): CurrentReading[] => {
			const seenAt = Date.parse(reading.message.seenAt)
			return tagFreshness(seenAt, snapshot.now, DEMO_FRESHNESS) === 'live' ? [{ tagId, reading, seenAt }] : []
		})
		.sort((left, right) => right.seenAt - left.seenAt)
}

function scannerTitle(status: DemoModeSnapshot['scannerStatus']): string {
	if (status === 'publishing') return 'Scanner publishing'
	if (status === 'idle') return 'Scanner idle'
	return 'Scanner offline'
}

export default function DemoScannerMonitor({ snapshot, onOpenOverview }: { snapshot: DemoModeSnapshot; onOpenOverview: () => void }) {
	const readings = currentReadings(snapshot)
	const retainedCount = Object.keys(snapshot.seenTags).length
	const latestSeenAt = Math.max(0, ...Object.values(snapshot.seenTags).map((reading) => Date.parse(reading.message.seenAt)))
	const secondsSinceMessage = latestSeenAt ? Math.max(0, Math.floor((snapshot.now - latestSeenAt) / 1_000)) : null
	const brokerConnected = snapshot.connectionState === 'live'

	return (
		<div className="page demo-scanner-page">
			<header className="page-head">
				<div>
					<p className="eyebrow">Prototype scanner · read-only</p>
					<h1>Scanner monitor</h1>
					<p className="page-sub">
						Only RFID observations arriving now appear here. Retained MQTT records remain available as clearly labelled last-known history
						on Overview.
					</p>
				</div>
			</header>

			<section className={`panel demo-scanner-status ${snapshot.scannerStatus}`} aria-live="polite">
				<span className="demo-scanner-status-icon" aria-hidden="true">
					<IconHub size={25} />
				</span>
				<div>
					<p className="eyebrow">Workshop Entry Scanner</p>
					<h2>{scannerTitle(snapshot.scannerStatus)}</h2>
					<p>
						{snapshot.scannerStatus === 'publishing'
							? `${readings.length} fresh ${readings.length === 1 ? 'tag is' : 'tags are'} currently in reader range.`
							: snapshot.scannerStatus === 'idle'
								? `No new publish for ${secondsSinceMessage ?? 0}s. It will be marked offline after 30 seconds.`
								: latestSeenAt
									? `No scanner publish for ${secondsSinceMessage ?? 30}s. Retained messages are not being presented as live readings.`
									: 'No live scanner publish has been received in this browser session.'}
					</p>
				</div>
				<span className={`scanner-state-badge ${snapshot.scannerStatus}`}>
					<i className="chip-dot" aria-hidden="true" />
					{snapshot.scannerStatus === 'publishing' ? 'Online' : snapshot.scannerStatus === 'idle' ? 'Idle' : 'Offline'}
				</span>
			</section>

			<section className="demo-scanner-metrics" aria-label="Scanner status details">
				<article className="panel">
					<IconBroadcast size={19} />
					<div>
						<strong>{brokerConnected ? 'MQTT connected' : 'MQTT disconnected'}</strong>
						<small>Browser-to-broker connection</small>
					</div>
				</article>
				<article className="panel">
					<IconActivity size={19} />
					<div>
						<strong>{readings.length} live now</strong>
						<small>Fresh observations only</small>
					</div>
				</article>
				<article className="panel">
					<IconClock size={19} />
					<div>
						<strong>{latestSeenAt ? lastSeenLabel(latestSeenAt, snapshot.now) : 'Never'}</strong>
						<small>Latest scanner publish</small>
					</div>
				</article>
				<article className="panel">
					<IconTerminal size={19} />
					<div>
						<strong>{retainedCount} retained</strong>
						<small>History, not current range</small>
					</div>
				</article>
			</section>

			<section className="panel demo-live-observations">
				<header className="panel-head">
					<div>
						<p className="eyebrow">Current reader range</p>
						<h2>Live RFID observations</h2>
					</div>
					{snapshot.scannerStatus === 'publishing' && (
						<span className="live-label">
							<i className="chip-dot ok" aria-hidden="true" /> Updating live
						</span>
					)}
				</header>

				{readings.length > 0 ? (
					<div className="demo-live-tag-list">
						{readings.map(({ tagId, reading, seenAt }) => (
							<article key={tagId}>
								<span className="demo-live-tag-emoji" aria-hidden="true">
									{reading.message.emoji}
								</span>
								<div>
									<strong>{reading.message.displayName}</strong>
									<code>{tagId}</code>
								</div>
								<dl>
									<div>
										<dt>Signal</dt>
										<dd>{reading.message.signalRssi} dBm</dd>
									</div>
									<div>
										<dt>Last read</dt>
										<dd>{lastSeenLabel(seenAt, snapshot.now)}</dd>
									</div>
								</dl>
							</article>
						))}
					</div>
				) : (
					<div className={`demo-scanner-empty ${snapshot.scannerStatus}`}>
						<IconBroadcast size={25} />
						<strong>{snapshot.scannerStatus === 'idle' ? 'The scanner has stopped publishing' : 'The scanner is offline'}</strong>
						<p>
							{snapshot.scannerStatus === 'idle'
								? 'No current tags are shown while the scanner is idle. Restart the mock scanner to resume live observations.'
								: 'Run the mock scanner to produce live observations. Previously retained tags are intentionally excluded from this screen.'}
						</p>
						<code>pnpm mock:scanner</code>
					</div>
				)}
			</section>

			<section className="demo-history-note">
				<div>
					<strong>Looking for the sample inventory?</strong>
					<p>
						Overview keeps retained tags as last-known history so you can explore their metadata and locations without pretending they are
						currently in range.
					</p>
				</div>
				<button className="button secondary" type="button" onClick={onOpenOverview}>
					Open Overview
				</button>
			</section>
		</div>
	)
}
