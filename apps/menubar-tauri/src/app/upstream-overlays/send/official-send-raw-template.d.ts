declare module "*.html?raw" {
  const template: string;
  export default template;
}

declare module "*.patch?raw" {
  const patch: string;
  export default patch;
}
