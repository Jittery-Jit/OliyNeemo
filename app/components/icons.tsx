// Neemo's icon set: 24×24 stroke icons drawn on a shared grid so every
// glyph carries the same weight. Icons are decorative by default; pass a
// label only when the icon stands alone.

import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { label?: string; size?: number }

function Icon({ children, label, size = 20, ...props }: IconProps & { children: ReactNode }) {
	return (
		<svg
			viewBox="0 0 24 24"
			width={size}
			height={size}
			fill="none"
			stroke="currentColor"
			strokeWidth={1.9}
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden={label ? undefined : true}
			role={label ? 'img' : undefined}
			aria-label={label}
			focusable="false"
			{...props}
		>
			{children}
		</svg>
	)
}

export function IconOverview(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M4 11.5 12 4.5l8 7" />
			<path d="M6 10v9h4.5v-5h3v5H18v-9" />
		</Icon>
	)
}

export function IconTagPlus(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M12.6 3.8H5.5a1.7 1.7 0 0 0-1.7 1.7v7.1c0 .45.18.88.5 1.2l6.4 6.4a1.7 1.7 0 0 0 2.4 0l4.7-4.7" />
			<circle cx="8.4" cy="8.4" r="1.15" fill="currentColor" stroke="none" />
			<path d="M18 3.5v6M15 6.5h6" />
		</Icon>
	)
}

export function IconHub(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M12 13.6v6.6" />
			<circle cx="12" cy="11.4" r="2.1" />
			<path d="M7.9 15.4a5.8 5.8 0 0 1 0-8.2M16.1 7.2a5.8 5.8 0 0 1 0 8.2" />
			<path d="M5.2 18a9.6 9.6 0 0 1 0-13.4M18.8 4.6a9.6 9.6 0 0 1 0 13.4" />
		</Icon>
	)
}

export function IconUser(props: IconProps) {
	return (
		<Icon {...props}>
			<circle cx="12" cy="8.2" r="3.6" />
			<path d="M4.8 20.2c.9-3.4 3.8-5.2 7.2-5.2s6.3 1.8 7.2 5.2" />
		</Icon>
	)
}

export function IconSearch(props: IconProps) {
	return (
		<Icon {...props}>
			<circle cx="10.8" cy="10.8" r="6" />
			<path d="m15.4 15.4 4.8 4.8" />
		</Icon>
	)
}

export function IconPlus(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M12 5v14M5 12h14" />
		</Icon>
	)
}

export function IconMinus(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M5 12h14" />
		</Icon>
	)
}

export function IconFit(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M9 4H4v5M15 4h5v5M9 20H4v-5M15 20h5v-5" />
		</Icon>
	)
}

export function IconCrosshair(props: IconProps) {
	return (
		<Icon {...props}>
			<circle cx="12" cy="12" r="6.4" />
			<path d="M12 2.6v4M12 17.4v4M2.6 12h4M17.4 12h4" />
			<circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
		</Icon>
	)
}

export function IconPin(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M12 21s-6.6-5.4-6.6-10.4a6.6 6.6 0 0 1 13.2 0C18.6 15.6 12 21 12 21Z" />
			<circle cx="12" cy="10.4" r="2.3" />
		</Icon>
	)
}

export function IconBroadcast(props: IconProps) {
	return (
		<Icon {...props}>
			<circle cx="12" cy="12" r="1.9" />
			<path d="M8.6 15.4a4.8 4.8 0 0 1 0-6.8M15.4 8.6a4.8 4.8 0 0 1 0 6.8" />
			<path d="M6.2 17.8a8.2 8.2 0 0 1 0-11.6M17.8 6.2a8.2 8.2 0 0 1 0 11.6" />
		</Icon>
	)
}

export function IconActivity(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M3 12h4l2.4-6.4L14 18.4 16.6 12H21" />
		</Icon>
	)
}

export function IconInfo(props: IconProps) {
	return (
		<Icon {...props}>
			<circle cx="12" cy="12" r="8.6" />
			<path d="M12 11v5.2" />
			<circle cx="12" cy="7.8" r="1.05" fill="currentColor" stroke="none" />
		</Icon>
	)
}

export function IconHelp(props: IconProps) {
	return (
		<Icon {...props}>
			<circle cx="12" cy="12" r="8.6" />
			<path d="M9.4 9.4a2.6 2.6 0 1 1 3.6 2.4c-.8.34-1 .9-1 1.7" />
			<circle cx="12" cy="16.6" r="1.05" fill="currentColor" stroke="none" />
		</Icon>
	)
}

export function IconClose(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="m6 6 12 12M18 6 6 18" />
		</Icon>
	)
}

export function IconChevronDown(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="m6 9.5 6 6 6-6" />
		</Icon>
	)
}

export function IconArrowRight(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M4.5 12h15M13.5 6l6 6-6 6" />
		</Icon>
	)
}

export function IconCheck(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="m4.5 12.6 5 5L19.5 7" />
		</Icon>
	)
}

export function IconCopy(props: IconProps) {
	return (
		<Icon {...props}>
			<rect x="8.6" y="8.6" width="11" height="11" rx="2" />
			<path d="M15.4 5.4v-.8a2 2 0 0 0-2-2H6.4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h.8" transform="translate(0 1)" />
		</Icon>
	)
}

export function IconClock(props: IconProps) {
	return (
		<Icon {...props}>
			<circle cx="12" cy="12" r="8.6" />
			<path d="M12 7.2V12l3.4 2.2" />
		</Icon>
	)
}

export function IconBox(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M4 8.2 12 4l8 4.2v7.6L12 20l-8-4.2Z" />
			<path d="M4 8.2 12 12.4l8-4.2M12 12.4V20" />
		</Icon>
	)
}

export function IconEdit(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M13.8 5.4 18.6 10.2 8.4 20.4H3.6v-4.8Z" />
			<path d="m16.2 3 4.8 4.8" transform="translate(-2.4 2.4)" />
		</Icon>
	)
}

export function IconRefresh(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" />
			<path d="M19.7 3.6v4.2h-4.2" />
		</Icon>
	)
}

export function IconPlay(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M8 5.4v13.2L19 12Z" />
		</Icon>
	)
}

export function IconSparkle(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M12 3.5 13.9 10l6.6 2-6.6 2L12 20.5 10.1 14l-6.6-2 6.6-2Z" />
		</Icon>
	)
}

export function IconTerminal(props: IconProps) {
	return (
		<Icon {...props}>
			<rect x="3" y="4.5" width="18" height="15" rx="2.2" />
			<path d="m7 9.5 3 2.7-3 2.7M12.6 15h4.4" />
		</Icon>
	)
}

export function IconAlert(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M12 4 2.8 19.6h18.4Z" />
			<path d="M12 10v4.4" />
			<circle cx="12" cy="16.9" r="1" fill="currentColor" stroke="none" />
		</Icon>
	)
}

export function IconEye(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M2.8 12S6.2 5.8 12 5.8 21.2 12 21.2 12 17.8 18.2 12 18.2 2.8 12 2.8 12Z" />
			<circle cx="12" cy="12" r="2.6" />
		</Icon>
	)
}

export function IconHand(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="M8.2 12.6V6.4a1.5 1.5 0 0 1 3 0v4.8V4.9a1.5 1.5 0 0 1 3 0v6.3-4.7a1.5 1.5 0 0 1 3 0v6.9c0 3.6-2.4 6.1-5.7 6.1-2.6 0-4-1.2-5.3-3.5l-1.9-3.4a1.4 1.4 0 0 1 2.4-1.4l1.5 2.4" />
		</Icon>
	)
}

export function IconKeyboard(props: IconProps) {
	return (
		<Icon {...props}>
			<rect x="2.8" y="6.5" width="18.4" height="11" rx="2" />
			<path d="M6.4 10h.01M10 10h.01M13.6 10h.01M17.2 10h.01M6.4 13.8h.01M17.2 13.8h.01M9.5 13.8h5" />
		</Icon>
	)
}

export function IconLayers(props: IconProps) {
	return (
		<Icon {...props}>
			<path d="m12 3.8 8.5 4.4L12 12.6 3.5 8.2Z" />
			<path d="m4.6 12.5 7.4 3.8 7.4-3.8M4.6 16.4l7.4 3.8 7.4-3.8" />
		</Icon>
	)
}
