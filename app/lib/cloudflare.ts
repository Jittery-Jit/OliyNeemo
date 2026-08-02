import { getCloudflareContext } from '@opennextjs/cloudflare'

export function getCloudflareEnv(): CloudflareEnv {
	return getCloudflareContext().env
}
