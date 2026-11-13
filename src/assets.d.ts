declare module "*.jpg" {
	const src: string; // data URL, inlined by esbuild
	export default src;
}
