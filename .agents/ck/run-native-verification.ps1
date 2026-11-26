$env:Path = 'C:\Users\Zed\AppData\Local\OpenClaw\deps\portable-node;' + $env:Path
rtk proxy node --version
rtk proxy pnpm exec turbo run test --concurrency=1 -- --maxWorkers=1 --pool=threads --hookTimeout=60000
exit $LASTEXITCODE
