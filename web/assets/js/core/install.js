/* 安装能力（PWA）：把应用装到手机桌面 / 电脑开始菜单。
 * - Chrome/Edge（含安卓）触发原生「安装」对话框
 * - iOS Safari 引导用户「添加到主屏幕」
 * - 已在独立窗口运行时不显示安装入口
 */
var ECInstall = (function () {
  'use strict';

  var deferred = null;          // beforeinstallprompt 事件对象
  var installed = false;
  var listeners = [];

  function standalone() {
    return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true;      // iOS
  }

  function isIOS() {
    return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }

  function isAndroid() { return /Android/.test(navigator.userAgent); }

  function emit() { listeners.forEach(function (f) { try { f(state()); } catch (e) { } }); }

  function state() {
    return {
      available: !!deferred && !installed,
      installed: standalone() || installed,
      ios: isIOS(),
      android: isAndroid()
    };
  }

  function init() {
    if (standalone()) { emit(); return; }
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferred = e;
      emit();
    });
    window.addEventListener('appinstalled', function () {
      installed = true;
      deferred = null;
      emit();
      if (window.ECUI) ECUI.toast('安装成功！下次从桌面图标直接打开', '', 4000);
    });
  }

  function onChange(f) { listeners.push(f); }

  // 触发原生安装；返回 Promise<'accepted'|'dismissed'|'unavailable'>
  function promptInstall() {
    if (!deferred) return Promise.resolve('unavailable');
    deferred.prompt();
    return deferred.userChoice.then(function (r) {
      deferred = null;
      emit();
      return r && r.outcome === 'accepted' ? 'accepted' : 'dismissed';
    });
  }

  return {
    init: init, state: state, onChange: onChange, promptInstall: promptInstall,
    standalone: standalone, isIOS: isIOS
  };
})();
if (typeof window !== 'undefined') { window.ECInstall = ECInstall; }
