import { useEffect, useState } from "react";
import { fetchProfile } from "../lib/ens";

function dicebearUrl(name: string) {
	return `https://api.dicebear.com/10.x/voxel-bot/svg?tags=animation&seed=${encodeURIComponent(name)}`;
}

interface Props {
	name: string;
	className?: string;
}

/** ENS avatar via the resolvio profile API, falling back to a universal DiceBear voxel-bot avatar. */
export default function NameAvatar({ name, className = "" }: Props) {
	const [src, setSrc] = useState(() => dicebearUrl(name));

	useEffect(() => {
		let cancelled = false;
		setSrc(dicebearUrl(name));
		fetchProfile(name).then((profile) => {
			if (!cancelled && profile?.avatar) setSrc(profile.avatar);
		});
		return () => {
			cancelled = true;
		};
	}, [name]);

	return (
		<img
			src={src}
			alt=""
			className={className}
			onError={(e) => {
				(e.currentTarget as HTMLImageElement).src = dicebearUrl(name);
			}}
		/>
	);
}
