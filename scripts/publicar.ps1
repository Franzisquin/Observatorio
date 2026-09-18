# Publica o site em electomaps.com.br.
#
# O deploy SUBSTITUI o site inteiro pelo conteudo desta pasta: o que nao estiver
# aqui some do ar. Por isso so publica o que ja esta no git, depois de puxar o
# trabalho do outro -- senao um deploy desfaz o do outro sem aviso.
#
# Uso: .\scripts\publicar.ps1
# Desfazer o ultimo deploy: npx wrangler rollback

Set-Location (Split-Path $PSScriptRoot)

if (git status --porcelain) {
    Write-Host "Ha mudancas sem commit. Faca commit antes de publicar." -ForegroundColor Red
    exit 1
}

git pull --no-edit
if ($LASTEXITCODE -ne 0) {
    Write-Host "git pull falhou (conflito?). Resolva e rode de novo." -ForegroundColor Red
    exit 1
}

git push
if ($LASTEXITCODE -ne 0) { exit 1 }

npx -y wrangler deploy
