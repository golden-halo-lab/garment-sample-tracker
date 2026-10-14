module.exports = {
  extends: null,
  appId: 'com.fazilandco.samples',
  productName: 'Fazil Samples',
  asar: true,
  files: ['desktop/**','public/**','server.mjs','domain.mjs','package.json'],
  directories: {output: 'dist-mac'},
  mac: {
    target: 'dir',
    identity: '-',
    icon: 'public/assets/icon.icns',
    category: 'public.app-category.business',
    hardenedRuntime: true,
    entitlements: 'desktop/entitlements.mac.plist',
    entitlementsInherit: 'desktop/entitlements.mac.plist'
  }
};
