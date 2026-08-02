import { getCloudflareEnv } from './cloudflare'

function requesterKey(request: Request): string {
	return request.headers.get('cf-connecting-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
}

export function rejectCrossOriginRequest(request: Request): Response | null {
	const origin = request.headers.get('origin')
	if (!origin) return null

	try {
		const originUrl = new URL(origin)
		const requestUrl = new URL(request.url)
		const requestHost = request.headers.get('host') ?? requestUrl.host
		if (originUrl.host === requestHost && originUrl.protocol === requestUrl.protocol) return null
	} catch {
		// Malformed origins are treated the same as untrusted origins.
	}

	return Response.json({ error: 'Cross-origin requests are not allowed.' }, { status: 403 })
}

export async function enforcePublicRateLimit(request: Request, scope: string): Promise<Response | null> {
	const result = await getCloudflareEnv().PUBLIC_RATE_LIMITER.limit({
		key: `${scope}:${requesterKey(request)}`,
	})
	if (result.success) return null
	return Response.json({ error: 'Too many requests. Wait a minute and try again.' }, { status: 429 })
}

export async function enforceGatewayRateLimit(gatewayId: string): Promise<Response | null> {
	const result = await getCloudflareEnv().GATEWAY_RATE_LIMITER.limit({
		key: `gateway:${gatewayId}`,
	})
	if (result.success) return null
	return Response.json({ error: 'The Gateway is sending data too quickly.' }, { status: 429 })
}
