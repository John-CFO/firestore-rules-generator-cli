module.exports = {
  root: true,
  env: {
    node: true,
    es2020: true,
  },
  parserOptions: {
    ecmaVersion: 2020,
    sourceType: "module",
  },
  extends: ["standard"],
  plugins: ["import", "node", "promise"],
  rules: {
    "no-console": "off",
  },
};
