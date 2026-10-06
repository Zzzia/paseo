const { signAsync } = require("@electron/osx-sign");

exports.default = async function signPersonalApp(options) {
  const identity = process.env.PASEO_MAC_SIGN_IDENTITY?.trim();
  if (!identity) {
    throw new Error("构建个人安装版必须设置 PASEO_MAC_SIGN_IDENTITY，指定钥匙串中的签名证书。");
  }

  // 沿用打包器生成的权限配置，仅显式选择个人证书，避免自动切换签名身份。
  await signAsync({
    ...options,
    identity,
    identityValidation: true,
    type: "development",
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
  });
};
