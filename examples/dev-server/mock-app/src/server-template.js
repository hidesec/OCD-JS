console.log("mock dev server bootstrapping at __BUILD_TIME__");
setTimeout(() => {
  console.log("mock dev server finished demo cycle");
  process.exit(0);
}, 400);
