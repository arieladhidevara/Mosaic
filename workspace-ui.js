// Native disclosure menus keep the header compact and keyboard accessible.
document.addEventListener('click',event=>{
  for(const menu of document.querySelectorAll('.header-menu[open]')){
    if(!menu.contains(event.target)||event.target.closest('button,a')&&!event.target.closest('#projectRenameForm'))menu.open=false;
  }
});
document.addEventListener('keydown',event=>{if(event.key==='Escape')document.querySelectorAll('.header-menu[open]').forEach(menu=>{menu.open=false;menu.querySelector('summary').focus()})});
