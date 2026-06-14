# Build stage
FROM node:20-alpine AS builder

WORKDIR /app

# 设置 npm 源
RUN npm config set registry https://registry.npmmirror.com

# 拷贝依赖配置
COPY package*.json ./

# 安装依赖（使用 npm install 以兼容 package.json 与 lock 文件不完全同步的情况）
RUN npm install

# 拷贝代码并构建
COPY . .
RUN npm run build

# Production stage
FROM nginx:alpine

# 拷贝构建产物
COPY --from=builder /app/dist /usr/share/nginx/html

# 拷贝 Nginx 配置 (可选，这里使用默认的)
# 如果需要处理 SPA 路由，可以自定义 nginx.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
