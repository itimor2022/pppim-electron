const fs = require('fs');
const path = require('path');

// 简单的图标复制和重命名工具（不需要额外依赖）
function copyAndRenameIcons(sourceImage) {
  if (!fs.existsSync(sourceImage)) {
    console.log(`❌ 源图标文件不存在: ${sourceImage}`);
    return false;
  }

  console.log(`🎨 开始处理图标: ${sourceImage}`);
  
  // 确保目标目录存在
  const publicIconsDir = path.join(__dirname, 'public', 'icons');
  const distIconsDir = path.join(__dirname, 'dist', 'icons');
  
  if (!fs.existsSync(publicIconsDir)) {
    fs.mkdirSync(publicIconsDir, { recursive: true });
  }
  if (!fs.existsSync(distIconsDir)) {
    fs.mkdirSync(distIconsDir, { recursive: true });
  }

  // 图标映射配置
  const iconMappings = [
    { target: 'icon.png', desc: '应用主图标' },
    { target: 'tray.png', desc: '系统托盘图标' },
    { target: 'tray@2x.png', desc: '高分辨率托盘图标' },
    { target: 'empty_tray.png', desc: '空状态托盘图标' }
  ];

  let successCount = 0;
  
  iconMappings.forEach(mapping => {
    try {
      const publicOutput = path.join(publicIconsDir, mapping.target);
      const distOutput = path.join(distIconsDir, mapping.target);
      
      // 复制文件
      fs.copyFileSync(sourceImage, publicOutput);
      fs.copyFileSync(sourceImage, distOutput);
      
      console.log(`✅ ${mapping.target} - ${mapping.desc}`);
      successCount++;
      
    } catch (error) {
      console.log(`❌ ${mapping.target} 处理失败:`, error.message);
    }
  });

  // 处理 ICO 文件
  const sourceExt = path.extname(sourceImage).toLowerCase();
  if (sourceExt === '.ico') {
    try {
      fs.copyFileSync(sourceImage, path.join(publicIconsDir, 'icon.ico'));
      fs.copyFileSync(sourceImage, path.join(distIconsDir, 'icon.ico'));
      console.log(`✅ icon.ico - 应用图标 (ICO格式)`);
      successCount++;
    } catch (error) {
      console.log(`❌ icon.ico 处理失败:`, error.message);
    }
  }

  // 处理 favicon
  try {
    fs.copyFileSync(sourceImage, path.join(__dirname, 'public', 'favicon.ico'));
    fs.copyFileSync(sourceImage, path.join(__dirname, 'dist', 'favicon.ico'));
    console.log(`✅ favicon.ico - 网页图标`);
    successCount++;
  } catch (error) {
    console.log(`❌ favicon.ico 处理失败:`, error.message);
  }
  
  console.log(`\n🎉 图标处理完成! 成功处理 ${successCount} 个图标`);
  console.log(`📁 图标位置:`);
  console.log(`   - public/icons/`);
  console.log(`   - dist/icons/`);
  console.log(`   - public/favicon.ico`);
  console.log(`   - dist/favicon.ico`);
  
  return true;
}

// 安装图像处理依赖的函数
function installSharp() {
  console.log('📦 正在安装 sharp 图像处理库...');
  const { execSync } = require('child_process');
  
  try {
    execSync('npm install sharp --save-dev', { stdio: 'inherit' });
    console.log('✅ sharp 安装成功');
    return true;
  } catch (error) {
    console.log('❌ sharp 安装失败:', error.message);
    return false;
  }
}

// 生成多尺寸ICO文件
async function generateMultiSizeIco(sourceImage, sharp) {
  try {
    const publicIconsDir = path.join(__dirname, 'public', 'icons');
    const distIconsDir = path.join(__dirname, 'dist', 'icons');

    // ICO文件需要的标准尺寸
    const icoSizes = [16, 32, 48, 64, 128, 256];
    const tempFiles = [];

    // 生成各个尺寸的PNG文件
    for (const size of icoSizes) {
      const tempFile = path.join(__dirname, `temp-${size}.png`);
      await sharp(sourceImage)
        .resize(size, size)
        .png()
        .toFile(tempFile);
      tempFiles.push(tempFile);
    }

    // 注意：这里我们只是复制最大尺寸的图标作为ICO
    // 真正的多尺寸ICO需要专门的库，如 ico-convert
    const largestPng = tempFiles[tempFiles.length - 1];
    fs.copyFileSync(largestPng, path.join(publicIconsDir, 'icon.ico'));
    fs.copyFileSync(largestPng, path.join(distIconsDir, 'icon.ico'));

    // 清理临时文件
    tempFiles.forEach(file => {
      try { fs.unlinkSync(file); } catch (e) {}
    });

    console.log(`✅ icon.ico 生成成功 (基于 ${icoSizes[icoSizes.length - 1]}x${icoSizes[icoSizes.length - 1]} PNG)`);
    return true;
  } catch (error) {
    console.log(`❌ icon.ico 生成失败:`, error.message);
    return false;
  }
}

// 使用 sharp 进行高质量图像处理
function generateIconsWithSharp(sourceImage) {
  try {
    const sharp = require('sharp');
    
    console.log(`🎨 使用 sharp 处理图标: ${sourceImage}`);
    
    // 图标配置
    const iconConfigs = [
      { name: 'icon.png', size: 512, desc: '应用主图标' },
      { name: 'icon-256.png', size: 256, desc: '应用图标 256x256' },
      { name: 'icon-128.png', size: 128, desc: '应用图标 128x128' },
      { name: 'icon-64.png', size: 64, desc: '应用图标 64x64' },
      { name: 'icon-48.png', size: 48, desc: '应用图标 48x48' },
      { name: 'icon-32.png', size: 32, desc: '应用图标 32x32' },
      { name: 'icon-16.png', size: 16, desc: '应用图标 16x16' },
      { name: 'tray.png', size: 16, desc: '系统托盘图标' },
      { name: 'tray@2x.png', size: 32, desc: '高分辨率托盘图标' },
      { name: 'empty_tray.png', size: 16, desc: '空状态托盘图标' }
    ];

    const publicIconsDir = path.join(__dirname, 'public', 'icons');
    const distIconsDir = path.join(__dirname, 'dist', 'icons');
    
    if (!fs.existsSync(publicIconsDir)) {
      fs.mkdirSync(publicIconsDir, { recursive: true });
    }
    if (!fs.existsSync(distIconsDir)) {
      fs.mkdirSync(distIconsDir, { recursive: true });
    }

    const promises = iconConfigs.map(async (config) => {
      try {
        const publicOutput = path.join(publicIconsDir, config.name);
        const distOutput = path.join(distIconsDir, config.name);
        
        await sharp(sourceImage)
          .resize(config.size, config.size)
          .png()
          .toFile(publicOutput);
          
        fs.copyFileSync(publicOutput, distOutput);
        
        console.log(`✅ ${config.name} (${config.size}x${config.size}) - ${config.desc}`);
        return true;
      } catch (error) {
        console.log(`❌ ${config.name} 生成失败:`, error.message);
        return false;
      }
    });

    // 生成多尺寸ICO文件
    const icoPromise = generateMultiSizeIco(sourceImage, sharp);

    return Promise.all([...promises, icoPromise]);
    
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      console.log('📦 sharp 未安装，是否要安装? (y/n)');
      // 在实际使用中，这里可以添加用户输入处理
      return false;
    }
    throw error;
  }
}

// 主函数
async function main() {
  console.log('🚀 图标生成工具');
  console.log('================');
  
  // 获取源图标文件
  const args = process.argv.slice(2);
  let sourceImage = args[0];
  
  if (!sourceImage) {
    // 自动查找源图标
    const candidates = [
      'new_icon_256.png',
      'original.png', 
      'original.ico',
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
      console.log('   node generate_icons_simple.js <图标文件路径>');
      console.log('\n支持的格式: PNG, JPG, JPEG, ICO');
      console.log('推荐尺寸: 512x512 或更大');
      process.exit(1);
    }
  }
  
  console.log(`📂 使用源图标: ${sourceImage}`);
  
  // 尝试使用 sharp 进行高质量处理
  try {
    const sharp = require('sharp');
    await generateIconsWithSharp(sourceImage);
    console.log('\n🎯 下一步: 运行 npm run build:win 重新打包应用');
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND') {
      console.log('⚠️  sharp 未安装，使用简单复制模式');
      copyAndRenameIcons(sourceImage);
      console.log('\n💡 提示: 安装 sharp 可获得更好的图标质量:');
      console.log('   npm install sharp --save-dev');
      console.log('\n🎯 下一步: 运行 npm run build:win 重新打包应用');
    } else {
      console.log('❌ 处理失败:', error.message);
      process.exit(1);
    }
  }
}

// 如果直接运行此脚本
if (require.main === module) {
  main().catch(console.error);
}

module.exports = { copyAndRenameIcons, generateIconsWithSharp };
