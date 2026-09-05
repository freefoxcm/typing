const path=require('path');
const fs=require('fs');
const out=path.resolve(__dirname,'../../output/reward-qa');fs.mkdirSync(out,{recursive:true});
const {chromium,expect}=require(process.env.PLAYWRIGHT_MODULE || '@playwright/test');
(async()=>{
const browser=await chromium.launch({...(process.env.REWARD_BROWSER_PATH?{executablePath:process.env.REWARD_BROWSER_PATH}:{channel:'chrome'}),headless:true,args:['--enable-unsafe-swiftshader','--use-angle=swiftshader']});
try {
  const context=await browser.newContext({viewport:{width:1360,height:950}});const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.request.post('http://127.0.0.1:8093/api/auth/child/login',{data:{name:'彩蛋体验2',pin:'1234'}});
  await page.goto('http://127.0.0.1:8093/');
  await expect(page.locator('.reward-celebration')).toBeAttached();
  await page.getByRole('button',{name:/跳过动画/}).click();
  await page.getByRole('link',{name:'现在玩'}).click();
  await expect(page.getByRole('button',{name:'开始游戏',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'操作指南',exact:true}).click();
  await expect(page.frameLocator('iframe').locator('#guide')).toBeVisible();
  await page.screenshot({path:path.join(out,'guide.png'),fullPage:true});
  await page.frameLocator('iframe').locator('#guide-ok').click();
  await page.getByRole('button',{name:'开始游戏',exact:true}).click();
  await expect(page.locator('.reward-start-strip')).toHaveCount(0);
  const initial=(await(await page.request.get('http://127.0.0.1:8093/api/easter-eggs/reward')).json()).reward.play;
  await context.setOffline(true);
  await expect(page.locator('.reward-network')).toBeVisible({timeout:20000});
  const canPlay=await page.locator('iframe').evaluate(el=>el.contentWindow.RewardBridge.canPlay());
  if(canPlay)throw new Error('Offline lease did not pause the game');
  await context.setOffline(false);
  await expect(page.locator('.reward-network')).toHaveCount(0,{timeout:8000});
  const restored=(await(await page.request.get('http://127.0.0.1:8093/api/easter-eggs/reward')).json()).reward.play;
  if(initial.expires_at!==restored.expires_at)throw new Error('Network recovery changed expiry');
  const admin=await browser.newContext();const adminPage=await admin.newPage();
  await adminPage.request.post('http://127.0.0.1:8093/api/auth/admin/login',{data:{username:'reward-qa',password:'reward-qa-local'}});
  await adminPage.goto('http://127.0.0.1:8093/admin');
  await adminPage.getByRole('button',{name:'彩蛋设置',exact:true}).click();
  await expect(adminPage.getByRole('heading',{name:'学习彩蛋'})).toBeVisible();
  await adminPage.screenshot({path:path.join(out,'settings.png'),fullPage:true});
  // A second page claims the same fixed deadline; the old page must stop.
  const other=await context.newPage();await other.goto('http://127.0.0.1:8093/rewards/play');
  await expect(other.getByRole('button',{name:'继续游戏',exact:true})).toBeEnabled();
  await other.getByRole('button',{name:'继续游戏',exact:true}).click();
  await other.getByRole('button',{name:'在此继续（接管原页面）'}).click();
  await expect(other.locator('.reward-start-strip')).toHaveCount(0);
  await expect(page.locator('.reward-ended')).toBeVisible({timeout:8000});

  const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
  const small=await mobile.newPage();
  await small.request.post('http://127.0.0.1:8093/api/auth/child/login',{data:{name:'彩蛋体验4',pin:'1234'}});
  await small.goto('http://127.0.0.1:8093/exercise/4');
  await expect(small.locator('.reward-celebration.is-reduced')).toBeAttached();
  await expect(small.locator('.reward-celebration')).toHaveCount(0);
  await small.getByRole('link',{name:'现在玩'}).click();
  await expect(small.getByRole('button',{name:'开始游戏',exact:true})).toBeEnabled();
  if(await small.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1))throw new Error('Mobile horizontal overflow');
  await small.getByRole('button',{name:/卡丁赛车.*选择赛道/}).tap();
  await expect(small.getByRole('alert')).toContainText('需要电脑键盘操作');
  const unplayed=(await(await small.request.get('http://127.0.0.1:8093/api/easter-eggs/reward')).json()).reward;
  if(unplayed.play)throw new Error('Unsupported device consumed time');
  await small.getByRole('button',{name:/星光冒险.*越过山丘/}).tap();
  await expect(small.getByRole('button',{name:'开始游戏',exact:true})).toBeEnabled();
  // Chromium full-page screenshots can reset touch emulation; keep them after touch assertions.
  await small.screenshot({path:path.join(out,'mobile.png'),fullPage:true});
  await adminPage.request.put('http://127.0.0.1:8093/api/admin/easter-egg-settings',{data:{enabled:false}});
  await expect(other.locator('.reward-ended')).toBeVisible({timeout:8000});
  await small.reload();await expect(small.locator('.reward-ended')).toBeVisible();
  if(errors.length)throw new Error(errors.join('\n'));
  console.log(JSON.stringify({checks:'offline pause/recovery, fixed deadline, takeover, admin settings, reduced motion, mobile layout and unsupported racer',errors}));
} finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
