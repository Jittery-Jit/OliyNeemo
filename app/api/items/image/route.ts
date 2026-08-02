import { getHubDb } from '../../../lib/hub-db'
import { getItemImageBucket, itemImageUrl } from '../../../lib/item-images'
import { rejectCrossOriginRequest } from '../../../lib/request-security'
import { getRequestSession } from '../../../lib/request-session'
import { getWorkspaceContext } from '../../../lib/workspace'

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const allowedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif'])

type ImageItemRow = {
	image_key: string | null
	updated_at: number
}

async function readImageBytes(request: Request): Promise<Uint8Array | Response> {
	if (!request.body) {
		return Response.json({ error: 'Choose an image to upload.' }, { status: 400 })
	}
	const chunks: Uint8Array[] = []
	const reader = request.body.getReader()
	let totalBytes = 0
	while (true) {
		const result = await reader.read()
		if (result.done) break
		totalBytes += result.value.byteLength
		if (totalBytes > MAX_IMAGE_BYTES) {
			await reader.cancel()
			return Response.json({ error: 'Choose an image smaller than 5 MB.' }, { status: 413 })
		}
		chunks.push(result.value)
	}
	if (!totalBytes) {
		return Response.json({ error: 'Choose an image to upload.' }, { status: 400 })
	}
	const bytes = new Uint8Array(totalBytes)
	let offset = 0
	for (const chunk of chunks) {
		bytes.set(chunk, offset)
		offset += chunk.byteLength
	}
	return bytes
}

async function getItem(itemId: string, ownerSub: string) {
	return getHubDb()
		.prepare('SELECT image_key, updated_at FROM items WHERE id = ? AND owner_sub = ?')
		.bind(itemId, ownerSub)
		.first<ImageItemRow>()
}

export async function GET(request: Request) {
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })

	try {
		const itemId = new URL(request.url).searchParams.get('id')?.trim()
		if (!itemId) return Response.json({ error: 'Item ID is required.' }, { status: 400 })
		const context = await getWorkspaceContext(session.sub)
		const item = await getItem(itemId, context.dataOwnerSub)
		if (!item?.image_key) return Response.json({ error: 'Item image was not found.' }, { status: 404 })
		const object = await getItemImageBucket().get(item.image_key)
		if (!object) return Response.json({ error: 'Item image was not found.' }, { status: 404 })

		return new Response(object.body, {
			headers: {
				'content-type': object.httpMetadata?.contentType ?? 'application/octet-stream',
				'cache-control': 'private, max-age=300',
				'content-length': String(object.size),
			},
		})
	} catch (error) {
		console.error('Could not load item image', error)
		return Response.json({ error: 'Item image could not be loaded.' }, { status: 500 })
	}
}

export async function PUT(request: Request) {
	const crossOriginResponse = rejectCrossOriginRequest(request)
	if (crossOriginResponse) return crossOriginResponse
	const session = await getRequestSession()
	if (!session) return Response.json({ error: 'Sign in required.' }, { status: 401 })

	try {
		const itemId = new URL(request.url).searchParams.get('id')?.trim()
		if (!itemId) return Response.json({ error: 'Item ID is required.' }, { status: 400 })
		const contentType = request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
		if (!allowedImageTypes.has(contentType)) {
			return Response.json({ error: 'Choose a JPG, PNG, WebP, or GIF image.' }, { status: 415 })
		}
		const declaredLength = Number(request.headers.get('content-length') ?? '0')
		if (declaredLength > MAX_IMAGE_BYTES) {
			return Response.json({ error: 'Choose an image smaller than 5 MB.' }, { status: 413 })
		}
		const bytes = await readImageBytes(request)
		if (bytes instanceof Response) return bytes

		const context = await getWorkspaceContext(session.sub)
		const item = await getItem(itemId, context.dataOwnerSub)
		if (!item) return Response.json({ error: 'Item not found.' }, { status: 404 })

		const extension =
			contentType === 'image/jpeg' ? 'jpg' : contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'gif'
		const nextKey = `items/${context.dataOwnerSub}/${itemId}/${crypto.randomUUID()}.${extension}`
		const bucket = getItemImageBucket()
		await bucket.put(nextKey, bytes, { httpMetadata: { contentType } })
		const updatedAt = Date.now()
		await getHubDb()
			.prepare('UPDATE items SET image_key = ?, updated_at = ? WHERE id = ? AND owner_sub = ?')
			.bind(nextKey, updatedAt, itemId, context.dataOwnerSub)
			.run()
		if (item.image_key) {
			try {
				await bucket.delete(item.image_key)
			} catch (error) {
				console.error('Could not remove replaced item image', error)
			}
		}

		return Response.json({ imageUrl: itemImageUrl(itemId, updatedAt), updatedAt })
	} catch (error) {
		console.error('Could not update item image', error)
		return Response.json({ error: 'Item image could not be updated.' }, { status: 500 })
	}
}
