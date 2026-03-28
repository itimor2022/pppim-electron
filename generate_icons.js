const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// 检查是否安装了 ImageMagick
function checkImageMagick() {
  try {
    execSync('magick -version', { stdio: 'ignore' });
    return true;
  } catch (error) {
    console.log('❌ ImageMagick 未安装。请先安装 ImageMagick:');
    console.log('   下载地址: https://imagemagick.org/script/download.php#windows');
    console.log('   或使用 chocolatey: choco install imagemagick');
    return false;
  }
}

// 图标配置
const iconConfigs = [
  // 应用图标
  { name: 'icon.ico', size: '256x256', format: 'ico', desc: '应用主图标 (ICO格式)' },
  { name: 'icon.png', size: '512x512', format: 'png', desc: '应用主图标 (PNG格式)' },
  
  // 系统托盘图标
  { name: 'tray.png', size: '16x16', format: 'png', desc: '系统托盘图标' },
  { name: 'tray@2x.png', size: '32x32', format: 'png', desc: '系统托盘图标 (高分辨率)' },
  
  // 空托盘图标
  { name: 'empty_tray.png', size: '16x16', format: 'png', desc: '空状态托盘图标' },
  
  // Favicon
  { name: 'favicon.ico', size: '32x32', format: 'ico', desc: '网页图标' },
];

// 生成图标
function generateIcons(sourceImage) {
  if (!fs.existsSync(sourceImage)) {
    console.log(`❌ 源图标文件不存在: ${sourceImage}`);
    return false;
  }

  console.log(`🎨 开始从 ${sourceImage} 生成图标...`);
  
  // 确保目标目录存在
  const publicIconsDir = path.join(__dirname, 'public', 'icons');
  const distIconsDir = path.join(__dirname, 'dist', 'icons');
  
  if (!fs.existsSync(publicIconsDir)) {
    fs.mkdirSync(publicIconsDir, { recursive: true });
  }
  if (!fs.existsSync(distIconsDir)) {
    fs.mkdirSync(distIconsDir, { recursive: true });
  }

  let successCount = 0;
  
  iconConfigs.forEach(config => {
    try {
      console.log(`📐 生成 ${config.name} (${config.size}) - ${config.desc}`);
      
      const publicOutput = path.join(publicIconsDir, config.name);
      const distOutput = path.join(distIconsDir, config.name);
      
      // 使用 ImageMagick 转换图标
      let command;
      if (config.format === 'ico') {
        // 生成 ICO 格式，包含多个尺寸
        command = `magick "${sourceImage}" -resize ${config.size} -background transparent "${publicOutput}"`;
      } else {
        // 生成 PNG 格式
        command = `magick "${sourceImage}" -resize ${config.size} -background transparent "${publicOutput}"`;
      }
      
      execSync(command, { stdio: 'ignore' });
      
      // 复制到 dist 目录
      fs.copyFileSync(publicOutput, distOutput);
      
      console.log(`✅ ${config.name} 生成成功`);
      successCount++;
      
    } catch (error) {
      console.log(`❌ ${config.name} 生成失败:`, error.message);
    }
  });
  
  console.log(`\n🎉 图标生成完成! 成功生成 ${successCount}/${iconConfigs.length} 个图标`);
  console.log(`📁 图标位置:`);
  console.log(`   - public/icons/`);
  console.log(`   - dist/icons/`);
  
  return successCount === iconConfigs.length;
}

// 主函数
function main() {
  console.log('🚀 图标生成工具');
  console.log('================');
  
  // 检查 ImageMagick
  if (!checkImageMagick()) {
    process.exit(1);
  }
  
  // 获取源图标文件
  const args = process.argv.slice(2);
  let sourceImage = args[0];
  
  if (!sourceImage) {
    // 自动查找源图标
    const candidates = [
      'new_icon_256.png',
      'original.png', 
      'temp_icon.png',
      'icon.png',
      'logo.png'
    ];
    
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        sourceImage = candidate;
        break;
      }
    }
    
    if (!sourceImage) {
      console.log('❌ 未找到源图标文件。请指定源图标文件:');
      console.log('   node generate_icons.js <图标文件路径>');
      console.log('\n支持的格式: PNG, JPG, JPEG, ICO');
      console.log('推荐尺寸: 512x512 或更大');
      process.exit(1);
    }
  }
  
  console.log(`📂 使用源图标: ${sourceImage}`);
  
  // 生成图标
  const success = generateIcons(sourceImage);
  
  if (success) {
    console.log('\n🎯 下一步:');
    console.log('   1. 检查生成的图标是否符合要求');
    console.log('   2. 运行 npm run build:win 重新打包应用');
    console.log('   3. 新的 exe 文件将使用更新后的图标');
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main();
}

module.exports = { generateIcons, iconConfigs };
