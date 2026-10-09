FROM node@sha256:d6aa754f16b3197301076f047b5def2f02ea1dbbc2ca920407d46d7ec7f87b20
RUN npm install --global pnpm@9.14.4
ENV CI=true ASTRO_TELEMETRY_DISABLED=1 HOME=/tmp
WORKDIR /workspace
