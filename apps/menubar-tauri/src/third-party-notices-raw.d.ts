declare module "*.md?raw" {
  const contents: string;
  export default contents;
}

declare module "*.txt?raw" {
  const contents: string;
  export default contents;
}
