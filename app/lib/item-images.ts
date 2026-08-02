import { getCloudflareEnv } from './cloudflare'

export function getItemImageBucket() {
	return getCloudflareEnv().ITEM_IMAGES
}

export function itemImageUrl(itemId: string, updatedAt: number) {
	return `/api/items/image?id=${encodeURIComponent(itemId)}&v=${updatedAt}`
}
