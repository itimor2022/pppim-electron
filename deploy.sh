#!/bin/bash

# 部署脚本
SERVER_IP="154.201.84.21"
SERVER_USER="your_username"
DEPLOY_PATH="/data1/online/Pc-Web-Demo/build/"

echo "开始构建项目..."
npm run build

if [ $? -eq 0 ]; then
    echo "构建成功，开始部署..."
    
    # 备份现有文件
    ssh $SERVER_USER@$SERVER_IP "sudo cp -r $DEPLOY_PATH ${DEPLOY_PATH}_backup_$(date +%Y%m%d_%H%M%S)"
    
    # 上传新文件
    rsync -avz --delete ./dist/ $SERVER_USER@$SERVER_IP:$DEPLOY_PATH
    
    # 设置权限
    ssh $SERVER_USER@$SERVER_IP "sudo chown -R nginx:nginx $DEPLOY_PATH && sudo chmod -R 755 $DEPLOY_PATH"
    
    # 重新加载nginx
    ssh $SERVER_USER@$SERVER_IP "sudo nginx -t && sudo nginx -s reload"
    
    echo "部署完成！"
    echo "访问地址: https://$SERVER_IP"
else
    echo "构建失败，部署终止"
    exit 1
fi
